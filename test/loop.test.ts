// Loop: Pi does the same task again after each answer, until someone interrupts the run or turns the loop off.
import {
    type App,
    cleanUp,
    context,
    lastText,
    newSession,
    openApp,
    owner,
    say,
    scriptedModel,
    until,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FauxResponseStep } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationId } from "@earendil-works/pi-durable";
import { LoopDoc } from "../src/server/docs.ts";

/** What Pi was asked, newest last. A request made again after an abort shows twice. */
const asked: string[] = [];

/** Runs before an answer, to act as if someone did something meanwhile; a promise is waited for. */
let beforeAnswer: (text: string) => Promise<void> | void = () => {};

const route: FauxResponseStep = async (request) => {
    const { text } = lastText(request as never);

    asked.push(text);
    await beforeAnswer(text);

    return fauxAssistantMessage([fauxText(`round: ${text.slice(0, 40)}`)]);
};

const model = scriptedModel(route);
let app: App;

before(async () => {
    app = await openApp(model);
});

after(async () => {
    await app?.close();
    cleanUp();
});

/** The rounds this session got, oldest first: each message starts with the loop's marker. */
async function rounds(id: ConversationId): Promise<string[]> {
    const conversation = await app.harness.conversation(id, context);
    const page = await conversation!.entries({}, 200, undefined, context);

    return page.items
        .filter((entry) => entry.kind === "pi.user")
        .map((entry) => JSON.stringify(entry.model))
        .filter((text) => text.includes("[loop] "))
        .reverse();
}

const loopOf = async (id: ConversationId) =>
    (await app.harness.snapshot(LoopDoc, id, context))?.loop;

/** A session of its own, with the loop of no earlier test running. */
async function startFresh(): Promise<ConversationId> {
    const id = await newSession(app);

    asked.length = 0;

    beforeAnswer = () => {};

    return id;
}

test("the task comes again after each answer, until someone turns the loop off", async () => {
    const id = await startFresh();

    beforeAnswer = async (text) => {
        // After two rounds, a person turns the loop off: the answer that follows ends it.
        if (text.startsWith("[loop] ") && (await rounds(id)).length === 2) {
            await app.commands.clearLoop(id, owner(app));
        }
    };

    await app.commands.startLoop(id, owner(app), "check the deploy");
    await until(async () => (await loopOf(id)) === undefined && !app.isBusy(id), "the loop to end");
    assert.equal(asked[0], "check the deploy", "the first round is the task itself");
    assert.equal((await rounds(id)).length, 2, "two rounds, and then the loop was off");
});

test("a stop ends the loop", async () => {
    const id = await startFresh();
    let stopped = false;

    beforeAnswer = async () => {
        if (!stopped && (await rounds(id)).length === 3) {
            stopped = true;
            await app.commands.abort(id, owner(app));
        }
    };

    await app.commands.startLoop(id, owner(app), "check the deploy");
    await until(async () => (await loopOf(id)) === undefined, "the stop to end the loop");
    await until(() => !app.isBusy(id), "the run to stop");
    const seen = (await rounds(id)).length;

    await say(app, id, "carry on without the loop");
    await until(() => !app.isBusy(id), "the answer");
    assert.equal((await rounds(id)).length, seen, "no round comes after the stop");
    assert.equal(await loopOf(id), undefined);
});

test("an interrupt ends the loop", async () => {
    const id = await startFresh();

    await app.commands.startLoop(id, owner(app), "check the deploy");
    await until(async () => (await rounds(id)).length >= 2, "the first rounds");
    await app.commands.submit(id, owner(app), {
        text: "do this instead",
        mode: "interrupt",
        requestId: crypto.randomUUID(),
    });
    assert.equal(await loopOf(id), undefined, "the interrupt ends the loop");
    await until(() => !app.isBusy(id), "the run to stop");
    assert.ok(asked.includes("do this instead"), "the message came after the interrupt");
    assert.equal(await loopOf(id), undefined);
});

test("in plan mode the loop stays set, and no round comes", async () => {
    const id = await startFresh();

    await app.commands.setPlan(id, owner(app), true);
    await app.commands.startLoop(id, owner(app), "check the deploy");
    await until(() => !app.isBusy(id), "the answer");
    assert.equal((await rounds(id)).length, 0, "plan mode proposes: it does not go round again");
    assert.ok((await loopOf(id)) !== undefined, "the loop waits for the plan to be approved");
});

test("a loop needs a task", async () => {
    const id = await startFresh();

    await assert.rejects(() => app.commands.startLoop(id, owner(app), "  "), /Say which task/);
    assert.equal(await loopOf(id), undefined);
});
