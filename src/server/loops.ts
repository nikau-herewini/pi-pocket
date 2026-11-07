/**
 * "Loop": one task that Pi does again after each of its answers, until someone interrupts the run or turns the loop
 * off. The loop extension (`extensions/loop.ts`) reads it after each answer and sends Pi on with the same task; this
 * module keeps it, for the command, the bar, and the person who set it up.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId } from "@earendil-works/pi-durable";
import type { PocketApp } from "./app.ts";
import { type Loop, LoopDoc } from "./docs.ts";
import { HttpError } from "./errors.ts";

const context = BACKGROUND_CONTEXT;

/** The extension that repeats a loop's task; while it is off, no loop goes on and none can be set. */
export const LOOP_EXTENSION = "pocket-loop";
/** How a repeated round starts, so Pi and people reading along know where it came from. */
export const LOOP_PREFIX = "[loop] ";
/** The longest task a loop repeats. */
export const MAX_LOOP_CHARS = 4000;

export class Loops {
    readonly #app: PocketApp;

    constructor(app: PocketApp) {
        this.#app = app;
    }

    /** A conversation's loop, if it has one. */
    async get(id: ConversationId): Promise<Loop | undefined> {
        return (await this.#app.harness.snapshot(LoopDoc, id, context))?.loop;
    }

    /** Set the loop: the task Pi does again after each answer. Throws with something a person can act on. */
    async set(id: ConversationId, by: string, task: string): Promise<Loop> {
        const app = this.#app;
        const text = task.trim();

        if (text === "") {
            throw new HttpError(400, "Say which task Pi repeats, such as /loop run the tests.");
        }

        if (text.length > MAX_LOOP_CHARS) {
            throw new HttpError(413, `A loop's task is limited to ${MAX_LOOP_CHARS} characters.`);
        }

        if (!app.loader.extensionNames().includes(LOOP_EXTENSION)) {
            throw new HttpError(409, "Loops are turned off in Extensions.");
        }

        const loop: Loop = { task: text, by, since: Date.now() };

        await app.harness.commit(async (tx) => {
            (await tx.doc(LoopDoc, id)).loop = loop;
        }, context);

        return loop;
    }

    /** Turn the loop off; true when there was one. */
    async clear(id: ConversationId): Promise<boolean> {
        return this.#app.harness.commit(async (tx) => {
            const doc = await tx.doc(LoopDoc, id);

            if (doc.loop === undefined) {
                return false;
            }

            delete doc.loop;

            return true;
        }, context);
    }
}
