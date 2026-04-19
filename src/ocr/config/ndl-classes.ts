export const NDL_CLASSES: Record<number, string> = {
  0: "text_block",
  1: "line_main",
  2: "line_caption",
  3: "line_ad",
  4: "line_note",
  5: "line_note_tochu",
  6: "block_fig",
  7: "block_ad",
  8: "block_pillar",
  9: "block_folio",
  10: "block_rubi",
  11: "block_chart",
  12: "block_eqn",
  13: "block_cfm",
  14: "block_eng",
  15: "block_table",
  16: "line_title",
};

export const NDL_CLASSES_LIST: string[] = Object.values(NDL_CLASSES);

export const NDL_ORG_NAMES: Record<string, string> = {
  text_block: "本文ブロック",
  line_main: "本文",
  line_caption: "キャプション",
  line_ad: "広告文字",
  line_note: "割注",
  line_note_tochu: "頭注",
  block_fig: "図版",
  block_ad: "広告",
  block_pillar: "柱",
  block_folio: "ノンブル",
  block_rubi: "ルビ",
  block_chart: "組織図",
  block_eqn: "数式",
  block_cfm: "化学式",
  block_eng: "欧文",
  block_table: "表組",
  line_title: "タイトル本文",
};

export function nameToOrgName(name: string): string {
  return NDL_ORG_NAMES[name] ?? name;
}
