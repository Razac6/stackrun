// Markdown tidy-up for notes: the usual things that break rendering or look messy.

/**
 * Closes an unclosed ``` code block, adds the missing space in "#Heading", turns "[]" /
 * "[x]" list checkboxes into proper task items, unifies "*" / "+" bullets to "-", strips
 * trailing spaces (keeping two-space line breaks) and collapses runs of blank lines.
 * Code blocks are left untouched. Returns what changed.
 */
export const repairMarkdown = (input: string) => {
  const fixes = new Set<string>();
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceMarker = '```';
  let blankRun = 0;

  lines.forEach((raw) => {
    const fence = raw.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        [, fenceMarker] = fence;
      } else if (raw.trim().startsWith(fenceMarker)) {
        inFence = false;
      }
      out.push(raw.replace(/\s+$/, ''));
      blankRun = 0;
      return;
    }
    if (inFence) {
      out.push(raw);
      return;
    }

    let line = raw;
    // trailing spaces (two spaces = intentional line break)
    if (/\S {2}$/.test(line)) line = line.replace(/ {3,}$/, '  ');
    else if (/[ \t]+$/.test(line)) {
      line = line.replace(/[ \t]+$/, '');
      fixes.add('Removed trailing spaces');
    }
    // "#Heading" -> "# Heading" (not "#tag" mid-text: only at line start, 1-6 #)
    const heading = line.match(/^(#{1,6})([^#\s].*)$/);
    // (a lone lower-case word after one # is a tag, like #todo)
    if (heading && !/^#[a-z0-9][\w-]*$/.test(line)) {
      line = `${heading[1]} ${heading[2]}`;
      fixes.add('Added spaces after # in headings');
    }
    // bullets: "* item" / "+ item" -> "- item"
    const bullet = line.match(/^(\s*)[*+](\s+)(.*)$/);
    if (bullet && !/^\s*\*\*/.test(line)) {
      line = `${bullet[1]}-${bullet[2]}${bullet[3]}`;
      fixes.add('Unified list bullets');
    }
    // "- []" / "- [X]" / "[] item" -> "- [ ]" / "- [x]"
    const box = line.match(/^(\s*)(?:-\s*)?\[( |x|X|)\]\s*(.*)$/);
    if (box) {
      const fixed = `${box[1]}- [${box[2].toLowerCase() === 'x' ? 'x' : ' '}] ${box[3]}`;
      if (fixed !== line) {
        line = fixed;
        fixes.add('Fixed checklist items');
      }
    }

    if (!line.trim()) {
      blankRun += 1;
      if (blankRun > 1) {
        fixes.add('Collapsed blank lines');
        return;
      }
    } else blankRun = 0;
    out.push(line);
  });

  if (inFence) {
    out.push(fenceMarker);
    fixes.add('Closed an unclosed code block');
  }
  // no blank lines at the very start / end
  while (out.length && !out[0].trim()) out.shift();
  while (out.length > 1 && !out[out.length - 1].trim()) out.pop();
  return { ok: true, text: out.join('\n'), fixes: [...fixes] };
};
