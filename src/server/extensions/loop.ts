/**
 * Loop: after each of Pi's answers the session's task comes again, so Pi does the same job again and again until
 * someone interrupts the run or turns the loop off. While this is off, no loop goes on.
 */
import { defineExtension, GenerationTask, hook, section } from "@earendil-works/pi-durable";
import { LoopDoc, PlanDoc } from "../docs.ts";
import type { PocketHost } from "../host.ts";
import { LOOP_EXTENSION, LOOP_PREFIX } from "../loops.ts";

const GUIDE = `A message that starts with "${LOOP_PREFIX.trim()}" is this session's loop: do its task again, without asking anyone whether to. Say in a line what changed since the last round, then end your answer as usual; the next round comes by itself.`;

export default function createLoop(host: PocketHost) {
    return defineExtension({
        name: LOOP_EXTENSION,
        sections: [
            section("loop", async (input, context) => {
                const loop = (await input.read.snapshot(LoopDoc, input.conversationId, context))
                    ?.loop;

                if (loop === undefined) {
                    return undefined;
                }

                return `This session is in a loop: \`${loop.task}\`. ${GUIDE} It ends when someone interrupts the run or turns the loop off, so never stop to ask whether to go on.`;
            }),
        ],
        hooks: [
            hook(GenerationTask, {
                onYield: async (_answer, api, context) => {
                    const loop = (await api.snapshot(LoopDoc, api.conversationId, context))?.loop;

                    if (loop === undefined) {
                        return undefined;
                    }

                    // In plan mode Pi proposes: a loop would propose the same plan again and again, and change nothing.
                    if ((await api.snapshot(PlanDoc, api.conversationId, context))?.on === true) {
                        return undefined;
                    }

                    // Past a spend limit Pi starts nothing with nobody asking. The loop stays as it is, and goes on
                    // again once the limit is raised.
                    const why = host.heldBack(api.conversationId);

                    if (why !== undefined) {
                        host.notice(
                            "warning",
                            `The loop did not go on: ${why}. Raise it, or turn the loop off.`,
                            api.conversationId,
                        );

                        return undefined;
                    }

                    return { continue: `${LOOP_PREFIX}${loop.task}` };
                },
            }),
        ],
    });
}
