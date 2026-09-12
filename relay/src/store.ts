import { DatabaseSync } from 'node:sqlite'

export const SNAPSHOT_EVERY = 200
export const MAX_LOG = 1000
export const MAX_ROOMS = 100
export const ROOM_TTL_DAYS = 14

const DAY_MS = 24 * 3600 * 1000

export interface StoredRoom {
    readonly id: string
    readonly title: string
    readonly width: number
    readonly height: number
    readonly snapshot: string
    readonly snapshotSeq: number
    readonly touchedAt: number
}

export interface StoredOp {
    readonly seq: number
    readonly stamp: number
    readonly body: Uint8Array
}

interface RoomRow {
    readonly id: string
    readonly touched_at: number
    readonly title: string
    readonly width: number
    readonly height: number
    readonly snapshot: string
    readonly snapshot_seq: number
}

interface OpRow {
    readonly seq: number
    readonly stamp: number
    readonly payload: Uint8Array
}

export class RoomStore {
    private db: DatabaseSync

    constructor(path: string) {
        this.db = new DatabaseSync(path)
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS room (
                id            TEXT PRIMARY KEY,
                created_at    INTEGER NOT NULL,
                touched_at    INTEGER NOT NULL,
                title         TEXT    NOT NULL,
                width         INTEGER NOT NULL,
                height        INTEGER NOT NULL,
                snapshot      TEXT    NOT NULL,
                snapshot_seq  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS op (
                room_id  TEXT    NOT NULL REFERENCES room(id) ON DELETE CASCADE,
                seq      INTEGER NOT NULL,
                stamp    INTEGER NOT NULL,
                payload  BLOB    NOT NULL,
                PRIMARY KEY (room_id, seq)
            );
        `)
    }

    saveRoom(room: StoredRoom): void {
        this.db
            .prepare(
                `INSERT INTO room
                    (id, created_at, touched_at, title, width, height, snapshot, snapshot_seq)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                    touched_at = excluded.touched_at,
                    title = excluded.title,
                    width = excluded.width,
                    height = excluded.height,
                    snapshot = excluded.snapshot,
                    snapshot_seq = excluded.snapshot_seq`,
            )
            .run(
                room.id,
                room.touchedAt,
                room.touchedAt,
                room.title,
                room.width,
                room.height,
                room.snapshot,
                room.snapshotSeq,
            )
    }

    loadAll(): { room: StoredRoom; ops: StoredOp[] }[] {
        const rooms = this.db
            .prepare(
                'SELECT id, touched_at, title, width, height, snapshot, snapshot_seq ' +
                    'FROM room ORDER BY id ASC',
            )
            .all() as unknown as RoomRow[]
        const opsStmt = this.db.prepare(
            'SELECT seq, stamp, payload FROM op WHERE room_id = ? ORDER BY seq ASC',
        )
        return rooms.map((row) => ({
            room: {
                id: row.id,
                title: row.title,
                width: row.width,
                height: row.height,
                snapshot: row.snapshot,
                snapshotSeq: row.snapshot_seq,
                touchedAt: row.touched_at,
            },
            ops: (opsStmt.all(row.id) as unknown as OpRow[]).map((op) => ({
                seq: op.seq,
                stamp: op.stamp,
                body: new Uint8Array(op.payload),
            })),
        }))
    }

    appendOp(id: string, op: StoredOp): void {
        this.db
            .prepare('INSERT INTO op (room_id, seq, stamp, payload) VALUES (?, ?, ?, ?)')
            .run(id, op.seq, op.stamp, Buffer.from(op.body))
    }

    setSnapshot(id: string, seq: number, snapshot: string): void {
        this.db
            .prepare('UPDATE room SET snapshot = ?, snapshot_seq = ? WHERE id = ?')
            .run(snapshot, seq, id)
        this.db.prepare('DELETE FROM op WHERE room_id = ? AND seq <= ?').run(id, seq)
    }

    deleteRoom(id: string): void {
        this.db.prepare('DELETE FROM room WHERE id = ?').run(id)
    }

    touch(id: string, now: number): void {
        this.db.prepare('UPDATE room SET touched_at = ? WHERE id = ?').run(now, id)
    }

    pruneStale(now: number): number {
        const cutoff = now - ROOM_TTL_DAYS * DAY_MS - 1
        const result = this.db.prepare('DELETE FROM room WHERE touched_at < ?').run(cutoff)
        return Number(result.changes)
    }

    close(): void {
        this.db.close()
    }
}
