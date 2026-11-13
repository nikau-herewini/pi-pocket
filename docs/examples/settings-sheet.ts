/**
 * Edit a greeting in a dedicated settings sheet, without sending it to Pi.
 * @title Greeting preferences
 */
import type { Host, Web } from "../../types/pocket.d.ts";

export default function greetingPreferences(_host: Host, web: Web) {
    web.settings(
        [
            { name: "greeting", label: "Greeting", type: "text", default: "Hello" },
            { name: "apiKey", label: "API key", type: "text", secret: true },
        ],
        { sheet: "settings" },
    );
    web.client("settings-sheet.js");
}
