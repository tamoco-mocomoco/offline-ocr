/**
 * Options page entrypoint.
 */

import {
  applyCleaningRules,
  loadRules,
  saveRules,
  type CleaningRule,
} from "../shared/cleaning";
import { loadSettings, saveSettings } from "../shared/settings";

const t = chrome.i18n.getMessage;

let rules: CleaningRule[] = [];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function newRule(): CleaningRule {
  return {
    id: uid(),
    name: t("newRuleName"),
    comment: "",
    pattern: "",
    flags: "g",
    replacement: "",
    enabled: true,
  };
}

function render(): void {
  const root = document.getElementById("rules")!;
  root.innerHTML = "";

  if (rules.length === 0) {
    const empty = document.createElement("p");
    empty.style.color = "#888";
    empty.style.fontSize = "12px";
    empty.style.margin = "0 0 8px";
    empty.textContent = t("emptyRulesMessage");
    root.appendChild(empty);
    return;
  }

  rules.forEach((rule, index) => {
    const card = document.createElement("div");
    card.className = "rule";

    const head = document.createElement("div");
    head.className = "rule-head";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = rule.enabled;
    enabled.title = t("ruleEnabledTitle");
    enabled.addEventListener("change", async () => {
      rule.enabled = enabled.checked;
      await saveRules(rules);
    });
    head.appendChild(enabled);

    const name = document.createElement("input");
    name.type = "text";
    name.className = "name";
    name.value = rule.name;
    name.placeholder = t("ruleNamePlaceholder");
    name.addEventListener("input", () => {
      rule.name = name.value;
      void saveRules(rules);
    });
    head.appendChild(name);

    const moveUp = document.createElement("button");
    moveUp.className = "secondary move-btn";
    moveUp.textContent = "\u25B2";
    moveUp.disabled = index === 0;
    moveUp.addEventListener("click", async () => {
      [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
      await saveRules(rules);
      render();
    });
    head.appendChild(moveUp);

    const moveDown = document.createElement("button");
    moveDown.className = "secondary move-btn";
    moveDown.textContent = "\u25BC";
    moveDown.disabled = index === rules.length - 1;
    moveDown.addEventListener("click", async () => {
      [rules[index], rules[index + 1]] = [rules[index + 1], rules[index]];
      await saveRules(rules);
      render();
    });
    head.appendChild(moveDown);

    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = t("deleteRuleButton");
    del.addEventListener("click", async () => {
      if (!confirm(t("deleteRuleConfirm", [rule.name]))) return;
      rules.splice(index, 1);
      await saveRules(rules);
      render();
    });
    head.appendChild(del);

    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "rule-body";

    const makeField = (
      labelText: string,
      value: string,
      placeholder: string,
      onInput: (v: string) => void,
      maxLength?: number,
    ): HTMLLabelElement => {
      const label = document.createElement("label");
      const span = document.createElement("span");
      span.textContent = labelText;
      const input = document.createElement("input");
      input.type = "text";
      input.value = value;
      input.placeholder = placeholder;
      if (maxLength != null) input.maxLength = maxLength;
      input.addEventListener("input", () => {
        onInput(input.value);
        void saveRules(rules);
      });
      label.appendChild(span);
      label.appendChild(input);
      return label;
    };

    body.appendChild(
      makeField(t("patternLabel"), rule.pattern, t("patternPlaceholder"), (v) => (rule.pattern = v)),
    );
    body.appendChild(
      makeField(t("flagsLabel"), rule.flags, "g", (v) => (rule.flags = v), 6),
    );
    body.appendChild(
      makeField(t("replacementLabel"), rule.replacement, t("replacementPlaceholder"), (v) => (rule.replacement = v)),
    );

    card.appendChild(body);

    const commentInput = document.createElement("input");
    commentInput.type = "text";
    commentInput.className = "name";
    commentInput.value = rule.comment ?? "";
    commentInput.placeholder = t("commentPlaceholder");
    commentInput.style.marginTop = "6px";
    commentInput.style.width = "100%";
    commentInput.style.boxSizing = "border-box";
    commentInput.style.fontSize = "11px";
    commentInput.style.color = "#888";
    commentInput.addEventListener("input", () => {
      rule.comment = commentInput.value;
      void saveRules(rules);
    });
    card.appendChild(commentInput);

    root.appendChild(card);
  });
}


async function init(): Promise<void> {
  // Apply data-i18n attributes in HTML
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n!;
    el.textContent = t(key);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder!;
    (el as HTMLInputElement | HTMLTextAreaElement).placeholder = t(key);
  });

  rules = await loadRules();
  if (rules.length === 0) {
    rules = [
      {
        id: uid(),
        name: t("seedRuleSpaceName"),
        comment: t("seedRuleSpaceComment"),
        pattern: "([ぁ-んァ-ヶ一-龥])\\s+([ぁ-んァ-ヶ一-龥])",
        flags: "g",
        replacement: "$1$2",
        enabled: false,
      },
      {
        id: uid(),
        name: t("seedRuleCommaName"),
        comment: t("seedRuleCommaComment"),
        pattern: "[,，]",
        flags: "g",
        replacement: "",
        enabled: false,
      },
      {
        id: uid(),
        name: t("seedRuleMultiNewlineName"),
        comment: t("seedRuleMultiNewlineComment"),
        pattern: "\\n{2,}",
        flags: "g",
        replacement: "\n",
        enabled: false,
      },
      {
        id: uid(),
        name: t("seedRuleNewlineName"),
        comment: t("seedRuleNewlineComment"),
        pattern: "\\n",
        flags: "g",
        replacement: "",
        enabled: false,
      },
    ];
    await saveRules(rules);
  }
  render();

  document.getElementById("add")!.addEventListener("click", async () => {
    rules.push(newRule());
    await saveRules(rules);
    render();
  });

  document.getElementById("export")!.addEventListener("click", () => {
    const json = JSON.stringify(rules, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cleaning-rules.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  const importFile = document.getElementById("import-file") as HTMLInputElement;
  document.getElementById("import")!.addEventListener("click", () => {
    importFile.click();
  });
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text) as CleaningRule[];
      if (!Array.isArray(imported)) throw new Error("invalid format");
      const dupes = imported
        .map((r) => r.name)
        .filter((name) => rules.some((e) => e.name === name));
      if (dupes.length > 0) {
        const names = dupes.map((n) => `  - ${n}`).join("\n");
        if (!confirm(t("importDuplicateConfirm") + "\n\n" + names)) return;
      }
      for (const r of imported) {
        const existing = rules.find((e) => e.name === r.name);
        if (existing) {
          existing.pattern = r.pattern;
          existing.flags = r.flags;
          existing.replacement = r.replacement;
          existing.comment = r.comment;
          existing.enabled = r.enabled;
        } else {
          r.id = uid();
          rules.push(r);
        }
      }
      await saveRules(rules);
      render();
    } catch {
      alert(t("importErrorMessage"));
    }
    importFile.value = "";
  });

  document.getElementById("open-shortcuts")!.addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  document.getElementById("run-test")!.addEventListener("click", async () => {
    const input = (document.getElementById("test-input") as HTMLTextAreaElement).value;
    const stored = await loadRules();
    const out = applyCleaningRules(input, stored);
    (document.getElementById("test-output") as HTMLTextAreaElement).value = out;
  });

  const alertCheckbox = document.getElementById("show-result-alert") as HTMLInputElement;
  const settings = await loadSettings();
  alertCheckbox.checked = settings.showResultAlert ?? true;
  alertCheckbox.addEventListener("change", async () => {
    const s = await loadSettings();
    s.showResultAlert = alertCheckbox.checked;
    await saveSettings(s);
  });
}

void init();
