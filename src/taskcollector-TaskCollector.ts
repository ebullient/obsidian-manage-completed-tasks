import { App, Editor, moment } from "obsidian";
import {
    TaskCollectorSettings,
    CompiledTasksSettings,
} from "./taskcollector-Settings";

export class TaskCollector {
    settings: TaskCollectorSettings;
    initSettings: CompiledTasksSettings;
    completedOrCanceled: RegExp;
    anyListItem: RegExp;
    anyTaskMark: RegExp;
    blockRef: RegExp;

    constructor(private app: App) {
        this.app = app;
        this.completedOrCanceled = new RegExp(/^(\s*- \[)[xX-](\] .*)$/);
        this.anyListItem = new RegExp(/^(\s*- )([^\\[].*)$/);
        this.anyTaskMark = new RegExp(/^(\s*- \[).(\] .*)$/);
        this.blockRef = new RegExp(/^(.*?)( \^[A-Za-z0-9-]+)?$/);
    }

    updateSettings(settings: TaskCollectorSettings): void {
        this.settings = settings;
        let momentMatchString = null;

        if (settings.appendDateFormat) {
            // YYYY-MM-DD or DD MM, YYYY or .. [(]YYYY-MM-DD[)] where the stuff in the brackets is literal
            const literals = [];

            const regex1 = RegExp("(\\[.*?\\]\\]?)", "g");
            let match;
            let i = 0;

            momentMatchString = settings.appendDateFormat;
            while ((match = regex1.exec(momentMatchString)) !== null) {
                momentMatchString = momentMatchString.replace(
                    match[0],
                    `%$${i}$%`
                );
                literals.push(
                    match[0]
                        .substring(1, match[0].length - 1)
                        .replace(/\(/g, "\\(") // escape a naked (
                        .replace(/\)/g, "\\)") // escape a naked )
                        .replace(/\[/g, "\\[") // escape a naked [
                        .replace(/\]/g, "\\]")
                ); // escape a naked ]
                i++;
            }

            // Now let's replace moment date formatting
            momentMatchString = momentMatchString
                .replace("YYYY", "\\d{4}") // 4-digit year
                .replace("YY", "\\d{2}") // 2-digit year
                .replace("DD", "\\d{2}") // day of month, padded
                .replace("D", "\\d{1,2}") // day of month, not padded
                .replace("MMM", "[A-Za-z]{3}") // month, abbrv
                .replace("MM", "\\d{2}") // month, padded
                .replace("M", "\\d{1,2}") // month, not padded
                .replace("HH", "\\d{2}") // 24-hour, padded
                .replace("H", "\\d{1,2}") // 24-hour, not padded
                .replace("hh", "\\d{2}") // 12-hour, padded
                .replace("h", "\\d{1,2}") // 12-hour, not padded
                .replace("mm", "\\d{2}") // minute, padded
                .replace("m", "\\d{1,2}"); // minute, not padded

            if (literals.length > 0) {
                for (let i = 0; i < literals.length; i++) {
                    momentMatchString = momentMatchString.replace(
                        `%$${i}$%`,
                        literals[i]
                    );
                }
            }
        }

        const completedTasks = this.settings.supportCanceledTasks
            ? "xX-"
            : "xX";

        const rightClickTaskMenu =
            this.settings.rightClickComplete ||
            this.settings.rightClickMark ||
            this.settings.rightClickMove ||
            this.settings.rightClickResetTask ||
            this.settings.rightClickResetAll ||
            this.settings.rightClickToggleAll;

        this.initSettings = {
            removeRegExp: this.tryCreateRemoveRegex(
                this.settings.removeExpression
            ),
            resetRegExp: this.tryCreateResetRegex(momentMatchString),
            incompleteTaskRegExp: this.tryCreateIncompleteRegex(
                this.settings.incompleteTaskValues
            ),
            rightClickTaskMenu: rightClickTaskMenu,
            completedTasks: completedTasks,
            completedTaskRegExp: this.tryCreateCompleteRegex(completedTasks),
            stripCompletedTask:
                this.tryCreateStripCompleteRegex(completedTasks),
        };
    }

    tryCreateRemoveRegex(param: string): RegExp {
        return param ? new RegExp(param, "g") : null;
    }

    tryCreateResetRegex(param: string): RegExp {
        return param ? new RegExp(param + "( \\^[A-Za-z0-9-]+)?$") : null;
    }

    tryCreateCompleteRegex(param: string): RegExp {
        return new RegExp(`^(\\s*- \\[)[${param}](\\] .*)$`);
    }
    tryCreateStripCompleteRegex(param: string): RegExp {
        return new RegExp(`^(\\s*-) \\[[${param}]\\] (.*)$`);
    }

    tryCreateIncompleteRegex(param: string): RegExp {
        return new RegExp(`^(\\s*- \\[)[${param}](\\] .*)$`);
    }

    removeCheckboxFromLine(lineText: string): string {
        return lineText.replace(this.initSettings.stripCompletedTask, "$1 $2");
    }

    /** _Complete_ an item: append completion text, remove configured strings */
    completeTaskLine(lineText: string, mark: string): string {
        let marked = lineText.replace(
            this.initSettings.incompleteTaskRegExp,
            "$1" + mark + "$2"
        );
        if (this.initSettings.removeRegExp) {
            marked = marked.replace(this.initSettings.removeRegExp, "");
        }
        if (this.settings.appendDateFormat) {
            let blockid = "";
            const match = this.blockRef.exec(marked);
            if (match && match[2]) {
                marked = match[1];
                blockid = match[2];
            }
            // if there is text to append, append it
            if (!marked.endsWith(" ")) {
                marked += " ";
            }
            marked += moment().format(this.settings.appendDateFormat) + blockid;
        }
        return marked;
    }

    completeEditorLineTask(editor: Editor, mark: string, i: number): void {
        const lineText = editor.getLine(i);

        // Does this line indicate an incomplete task?
        const incompleteTask =
            this.initSettings.incompleteTaskRegExp.exec(lineText);
        if (incompleteTask) {
            const marked = this.completeTaskLine(lineText, mark);
            editor.setLine(i, marked);
        }
    }

    completeTaskOnCurrentLine(editor: Editor, mark: string): void {
        if (editor.somethingSelected()) {
            const cursorStart = editor.getCursor("from");
            const cursorEnd = editor.getCursor("to");
            for (let i = cursorStart.line; i <= cursorEnd.line; i++) {
                this.completeEditorLineTask(editor, mark, i);
            }
            editor.setSelection(cursorStart, {
                line: cursorEnd.line,
                ch: editor.getLine(cursorEnd.line).length,
            });
        } else {
            const anchor = editor.getCursor("from");
            this.completeEditorLineTask(editor, mark, anchor.line);
        }
    }

    markAllTasksComplete(source: string, mark: string): string {
        const lines = source.split("\n");
        const result: string[] = [];

        for (const line of lines) {
            if (this.initSettings.incompleteTaskRegExp.exec(line)) {
                result.push(this.completeTaskLine(line, mark));
            } else {
                result.push(line);
            }
        }
        return result.join("\n");
    }

    markTaskInSource(
        source: string,
        mark: string,
        lines: number[] = []
    ): string {
        const split = source.split("\n");
        for (const n of lines) {
            // if it isn't a task...
            if (!this.anyTaskMark.test(split[n])) {
                const match = this.anyListItem.exec(split[n]);
                if (match && match[2]) {
                    // it's a list item! let's make it a task, and carry on
                    split[n] = match[1] + "[ ] " + match[2];
                } else {
                    // not a list item: nothing else to do with this line
                    continue;
                }
            }

            if (
                this.initSettings.completedTasks.indexOf(mark) >= 0 &&
                this.isIncompleteTaskLine(split[n])
            ) {
                split[n] = this.completeTaskLine(split[n], mark);
            } else if (this.settings.incompleteTaskValues.indexOf(mark) >= 0) {
                split[n] = this.resetTaskLine(split[n], mark);
            }
        }
        return split.join("\n");
    }

    resetTaskLine(lineText: string, mark = " "): string {
        let marked = lineText.replace(this.anyTaskMark, "$1" + mark + "$2");

        let blockid = "";
        const match = this.blockRef.exec(marked);
        if (match && match[2]) {
            marked = match[1];
            blockid = match[2];
        }
        if (this.initSettings.resetRegExp) {
            marked = marked.replace(this.initSettings.resetRegExp, "");
        }
        marked = marked.replace(/\s*$/, blockid);
        return marked;
    }

    resetTaskOnLine(editor: Editor, i: number, mark: string): void {
        const lineText = editor.getLine(i);

        // remove the guard: just change the value
        const marked = this.resetTaskLine(lineText, mark);
        editor.setLine(i, marked);
    }

    resetTaskOnCurrentLine(editor: Editor, mark = " "): void {
        if (editor.somethingSelected()) {
            const cursorStart = editor.getCursor("from");
            const cursorEnd = editor.getCursor("to");
            for (let i = cursorStart.line; i <= cursorEnd.line; i++) {
                this.resetTaskOnLine(editor, i, mark);
            }
            editor.setSelection(cursorStart, {
                line: cursorEnd.line,
                ch: editor.getLine(cursorEnd.line).length,
            });
        } else {
            const anchor = editor.getCursor("from");
            this.resetTaskOnLine(editor, anchor.line, mark);
        }
    }

    resetAllTasks(source: string): string {
        const LOG_HEADING = this.settings.completedAreaHeader || "## Log";
        const lines = source.split("\n");

        const result: string[] = [];
        let inCompletedSection = false;
        for (const line of lines) {
            if (inCompletedSection) {
                if (line.startsWith("#") || line.trim() === "---") {
                    inCompletedSection = false;
                }
                result.push(line);
            } else if (line.trim() === LOG_HEADING) {
                inCompletedSection = true;
                result.push(line);
            } else if (this.completedOrCanceled.exec(line)) {
                result.push(this.resetTaskLine(line));
            } else {
                result.push(line);
            }
        }
        return result.join("\n");
    }

    moveCompletedTasksInFile(source: string): string {
        const LOG_HEADING = this.settings.completedAreaHeader || "## Log";
        const lines = source.split("\n");

        if (source.indexOf(LOG_HEADING) < 0) {
            if (lines[lines.length - 1].trim() !== "") {
                lines.push("");
            }
            lines.push(LOG_HEADING);
        }

        const remaining = [];
        const completedSection = [];
        const newTasks = [];
        let inCompletedSection = false;
        let inTask = false;
        let completedItemsIndex = lines.length;

        for (let line of lines) {
            if (inCompletedSection) {
                if (line.startsWith("#") || line.trim() === "---") {
                    inCompletedSection = false;
                    remaining.push(line);
                } else {
                    completedSection.push(line);
                }
            } else if (line.trim() === LOG_HEADING) {
                inCompletedSection = true;
                completedItemsIndex = remaining.push(line);
                remaining.push("%%%COMPLETED_ITEMS_GO_HERE%%%");
            } else {
                const taskMatch = line.match(/^(\s*)- \[(.)\]/);
                if (this.isCompletedTaskLine(line)) {
                    if (this.settings.completedAreaRemoveCheckbox) {
                        line = line.replace(
                            this.initSettings.stripCompletedTask,
                            "$1 $2"
                        );
                    }
                    inTask = true;
                    newTasks.push(line);
                } else if (inTask && !taskMatch && line.match(/^( {2,}|\t)/)) {
                    newTasks.push(line);
                } else {
                    inTask = false;
                    remaining.push(line);
                }
            }
        }

        let result = remaining
            .slice(0, completedItemsIndex)
            .concat(...newTasks)
            .concat(...completedSection);
        if (completedItemsIndex < remaining.length - 1) {
            result = result.concat(remaining.slice(completedItemsIndex + 1));
        }
        return result.join("\n");
    }

    isCompletedTaskLine(lineText: string): boolean {
        return this.initSettings.completedTaskRegExp.test(lineText);
    }

    isIncompleteTaskLine(lineText: string): boolean {
        return this.initSettings.incompleteTaskRegExp.test(lineText);
    }
}
