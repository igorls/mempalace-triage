import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { maintainers, notes, triageItems } from "@/db/schema";
import { recordActivity } from "./activity";

export type Visibility = "public" | "maintainers";

export class NoteError extends Error {
  constructor(
    public code: "item_not_found" | "empty_body" | "body_too_long",
    message: string,
  ) {
    super(message);
  }
}

const MAX_BODY_LEN = 16_000;

export interface NoteRow {
  id: number;
  itemNumber: number;
  authorLogin: string;
  authorDisplayName: string | null;
  body: string;
  visibility: Visibility;
  createdAt: Date;
}

export async function createNote(opts: {
  itemNumber: number;
  maintainerId: number;
  body: string;
  visibility?: Visibility;
}): Promise<NoteRow> {
  const body = opts.body.trim();
  if (body.length === 0) {
    throw new NoteError("empty_body", "note body cannot be empty");
  }
  if (body.length > MAX_BODY_LEN) {
    throw new NoteError(
      "body_too_long",
      `note body must be ≤ ${MAX_BODY_LEN} chars (got ${body.length})`,
    );
  }
  const [item] = await db
    .select({ number: triageItems.number })
    .from(triageItems)
    .where(eq(triageItems.number, opts.itemNumber));
  if (!item) {
    throw new NoteError("item_not_found", `item #${opts.itemNumber} not found`);
  }

  const [inserted] = await db
    .insert(notes)
    .values({
      itemNumber: opts.itemNumber,
      maintainerId: opts.maintainerId,
      body,
      visibility: opts.visibility ?? "maintainers",
    })
    .returning({ id: notes.id });
  if (!inserted) throw new Error("note insert returned no row");

  const fresh = await loadNote(inserted.id);
  if (!fresh) throw new Error("note insert reported success but no row found");

  await recordActivity({
    maintainerId: opts.maintainerId,
    action: "note.create",
    itemNumber: opts.itemNumber,
    after: {
      noteId: fresh.id,
      visibility: fresh.visibility,
      preview: body.slice(0, 200),
    },
    broadcast: ["activity"],
  });
  return fresh;
}

async function loadNote(id: number): Promise<NoteRow | null> {
  const [row] = await db
    .select({
      id: notes.id,
      itemNumber: notes.itemNumber,
      authorLogin: maintainers.githubLogin,
      authorDisplayName: maintainers.displayName,
      body: notes.body,
      visibility: notes.visibility,
      createdAt: notes.createdAt,
    })
    .from(notes)
    .innerJoin(maintainers, eq(notes.maintainerId, maintainers.id))
    .where(eq(notes.id, id));
  return row ?? null;
}

export async function listNotes(itemNumber: number): Promise<NoteRow[]> {
  return await db
    .select({
      id: notes.id,
      itemNumber: notes.itemNumber,
      authorLogin: maintainers.githubLogin,
      authorDisplayName: maintainers.displayName,
      body: notes.body,
      visibility: notes.visibility,
      createdAt: notes.createdAt,
    })
    .from(notes)
    .innerJoin(maintainers, eq(notes.maintainerId, maintainers.id))
    .where(eq(notes.itemNumber, itemNumber))
    .orderBy(desc(notes.createdAt));
}
