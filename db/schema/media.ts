import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageKey: varchar("storage_key", { length: 64 }).notNull(),
    mimeType: varchar("mime_type", { length: 64 }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("media_storage_key_unique").on(t.storageKey),
    check(
      "media_positive_size",
      sql`${t.width} > 0 AND ${t.height} > 0 AND ${t.sizeBytes} > 0`,
    ),
  ],
);
