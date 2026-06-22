/**
 * Options page entrypoint.
 */

import {
  applyCleaningRules,
  loadRules,
  saveRules,
  type CleaningRule,
} from "../shared/cleaning";
import {
  DEBUG_LAST_CROP_KEY,
  loadSettings,
  saveSettings,
  type DebugLastCrop,
} from "../shared/settings";
import {
  loadAIPrompts,
  saveAIPrompts,
  type AIPrompt,
} from "../shared/ai-prompts";

const AI_DOCS_URL = "https://developer.chrome.com/docs/ai/built-in";

const t = chrome.i18n.getMessage;

let rules: CleaningRule[] = [];
let aiPrompts: AIPrompt[] = [];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function newAIPrompt(): AIPrompt {
  return {
    id: uid(),
    title: t("newPromptTitle"),
    content: "",
  };
}

async function getActivePrompt(): Promise<AIPrompt | undefined> {
  const s = await loadSettings();
  return aiPrompts.find((p) => p.id === s.aiActivePromptId) ?? aiPrompts[0];
}

function refreshAIPromptDropdown(activeId: string | undefined): void {
  const select = document.getElementById("ai-active-prompt") as HTMLSelectElement | null;
  if (!select) return;
  select.innerHTML = "";
  if (aiPrompts.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("aiNoPromptOption");
    opt.disabled = true;
    opt.selected = true;
    select.appendChild(opt);
    return;
  }
  for (const p of aiPrompts) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.title || t("promptTitlePlaceholder");
    select.appendChild(opt);
  }
  const fallback = aiPrompts[0]?.id ?? "";
  select.value = activeId && aiPrompts.some((p) => p.id === activeId) ? activeId : fallback;
}

function renderActivePromptEditor(active: AIPrompt | undefined): void {
  const editor = document.getElementById("ai-prompt-editor")!;
  const empty = document.getElementById("ai-prompt-empty")!;
  const titleInput = document.getElementById("ai-prompt-title") as HTMLInputElement;
  const contentInput = document.getElementById("ai-prompt-content") as HTMLTextAreaElement;
  const deleteBtn = document.getElementById("delete-ai-prompt") as HTMLButtonElement;

  if (!active) {
    editor.style.display = "none";
    empty.style.display = "block";
    deleteBtn.disabled = true;
    return;
  }
  editor.style.display = "block";
  empty.style.display = "none";
  deleteBtn.disabled = false;
  titleInput.value = active.title;
  titleInput.placeholder = t("promptTitlePlaceholder");
  contentInput.value = active.content;
}

async function renderAI(): Promise<void> {
  const active = await getActivePrompt();
  refreshAIPromptDropdown(active?.id);
  renderActivePromptEditor(active);
  if (active) {
    const s = await loadSettings();
    if (s.aiActivePromptId !== active.id) {
      s.aiActivePromptId = active.id;
      await saveSettings(s);
    }
  }
}

interface LanguageModelGlobal {
  availability?: () => Promise<string>;
}
async function checkAIAvailability(): Promise<{ ok: boolean; status: string }> {
  const g = globalThis as unknown as { LanguageModel?: LanguageModelGlobal };
  if (!g.LanguageModel || typeof g.LanguageModel.availability !== "function") {
    return { ok: false, status: "unsupported" };
  }
  try {
    const a = await g.LanguageModel.availability();
    return { ok: a === "available" || a === "downloadable" || a === "downloading", status: a };
  } catch {
    return { ok: false, status: "error" };
  }
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
  const debugCheckbox = document.getElementById("debug-mode") as HTMLInputElement;
  const settings = await loadSettings();
  alertCheckbox.checked = settings.showResultAlert ?? true;
  debugCheckbox.checked = settings.debugMode ?? false;
  alertCheckbox.addEventListener("change", async () => {
    const s = await loadSettings();
    s.showResultAlert = alertCheckbox.checked;
    await saveSettings(s);
  });
  debugCheckbox.addEventListener("change", async () => {
    const s = await loadSettings();
    s.debugMode = debugCheckbox.checked;
    await saveSettings(s);
  });

  const previewEl = document.getElementById("debug-crop-preview") as HTMLElement;
  const imageEl = document.getElementById("debug-crop-image") as HTMLImageElement;
  const metaEl = document.getElementById("debug-crop-meta") as HTMLElement;

  document.getElementById("show-debug-crop")!.addEventListener("click", async () => {
    console.log("[ndlocr-lite][debug] show button clicked");
    const obj = await chrome.storage.local.get(DEBUG_LAST_CROP_KEY);
    const crop = obj?.[DEBUG_LAST_CROP_KEY] as DebugLastCrop | undefined;
    console.log("[ndlocr-lite][debug] crop found?", !!crop, crop && `${crop.width}x${crop.height}`);
    if (!crop) {
      previewEl.style.display = "none";
      metaEl.textContent = t("debugCropEmpty");
      return;
    }
    imageEl.src = crop.dataUrl;
    previewEl.style.display = "block";
    const elapsedSec = Math.round((Date.now() - crop.timestamp) / 1000);
    metaEl.textContent = t("debugCropMeta", [
      String(crop.width),
      String(crop.height),
      String(elapsedSec),
    ]);
  });

  document.getElementById("clear-debug-crop")!.addEventListener("click", async () => {
    await chrome.storage.local.remove(DEBUG_LAST_CROP_KEY);
    imageEl.removeAttribute("src");
    previewEl.style.display = "none";
    metaEl.textContent = t("debugCropCleared");
  });

  // ── Offline AI section ──
  aiPrompts = await loadAIPrompts();
  if (aiPrompts.length === 0) {
    aiPrompts = [
      {
        id: uid(),
        title: t("seedPromptCleanupTitle"),
        content: t("seedPromptCleanupContent"),
      },
      {
        id: uid(),
        title: t("seedPromptJsonTitle"),
        content: t("seedPromptJsonContent"),
      },
      {
        id: uid(),
        title: t("seedPromptMarkdownTitle"),
        content: t("seedPromptMarkdownContent"),
      },
      {
        id: uid(),
        title: t("seedPromptTranslateTitle"),
        content: t("seedPromptTranslateContent"),
      },
    ];
    await saveAIPrompts(aiPrompts);
  }
  await renderAI();

  const aiEnabled = document.getElementById("ai-enabled") as HTMLInputElement;
  aiEnabled.checked = settings.aiEnabled ?? false;
  aiEnabled.addEventListener("change", async () => {
    const s = await loadSettings();
    s.aiEnabled = aiEnabled.checked;
    await saveSettings(s);
  });

  const activePromptSelect = document.getElementById("ai-active-prompt") as HTMLSelectElement;
  activePromptSelect.addEventListener("change", async () => {
    const s = await loadSettings();
    s.aiActivePromptId = activePromptSelect.value || undefined;
    await saveSettings(s);
    const active = aiPrompts.find((p) => p.id === activePromptSelect.value);
    renderActivePromptEditor(active);
  });

  const titleInput = document.getElementById("ai-prompt-title") as HTMLInputElement;
  titleInput.addEventListener("input", async () => {
    const active = await getActivePrompt();
    if (!active) return;
    active.title = titleInput.value;
    await saveAIPrompts(aiPrompts);
    refreshAIPromptDropdown(active.id);
  });

  const contentInput = document.getElementById("ai-prompt-content") as HTMLTextAreaElement;
  contentInput.addEventListener("input", async () => {
    const active = await getActivePrompt();
    if (!active) return;
    active.content = contentInput.value;
    await saveAIPrompts(aiPrompts);
  });

  document.getElementById("open-ai-docs")!.addEventListener("click", () => {
    chrome.tabs.create({ url: AI_DOCS_URL });
  });

  document.getElementById("add-ai-prompt")!.addEventListener("click", async () => {
    const p = newAIPrompt();
    aiPrompts.push(p);
    await saveAIPrompts(aiPrompts);
    const s = await loadSettings();
    s.aiActivePromptId = p.id;
    await saveSettings(s);
    await renderAI();
  });

  document.getElementById("delete-ai-prompt")!.addEventListener("click", async () => {
    const active = await getActivePrompt();
    if (!active) return;
    if (!confirm(t("deletePromptConfirm", [active.title]))) return;
    aiPrompts = aiPrompts.filter((p) => p.id !== active.id);
    await saveAIPrompts(aiPrompts);
    const s = await loadSettings();
    s.aiActivePromptId = aiPrompts[0]?.id;
    await saveSettings(s);
    await renderAI();
  });

  document.getElementById("export-ai-prompts")!.addEventListener("click", () => {
    const json = JSON.stringify(aiPrompts, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ai-prompts.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  const importAIFile = document.getElementById("import-ai-prompts-file") as HTMLInputElement;
  document.getElementById("import-ai-prompts")!.addEventListener("click", () => {
    importAIFile.click();
  });
  importAIFile.addEventListener("change", async () => {
    const file = importAIFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text) as AIPrompt[];
      if (!Array.isArray(imported)) throw new Error("invalid format");
      for (const p of imported) {
        const existing = aiPrompts.find((e) => e.title === p.title);
        if (existing) {
          existing.content = p.content;
        } else {
          p.id = uid();
          aiPrompts.push(p);
        }
      }
      await saveAIPrompts(aiPrompts);
      await renderAI();
    } catch {
      alert(t("importErrorMessage"));
    }
    importAIFile.value = "";
  });

  // Gemini Nano availability hint
  const availabilityEl = document.getElementById("ai-availability")!;
  const { ok, status } = await checkAIAvailability();
  if (!ok) {
    availabilityEl.style.display = "block";
    availabilityEl.className = "availability ng";
    availabilityEl.textContent =
      status === "unsupported"
        ? t("aiAvailabilityUnsupported")
        : t("aiAvailabilityUnavailable");
  } else if (status === "downloadable" || status === "downloading") {
    availabilityEl.style.display = "block";
    availabilityEl.className = "availability ok";
    availabilityEl.textContent = t("aiAvailabilityDownload");
  }
}

void init();
