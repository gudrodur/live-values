#!/usr/bin/env node
// Shared shell-command cleaners for gates that judge shell commands.
//
// Every gate judges the COMMAND, not the text the command carries: a heredoc
// body is prose or an embedded program the agent did not run as a shell
// command, and a quoted span is a message, a filter pattern, or a payload.
// Judging those spans as commands fires the gate on reads (heredoc briefs
// fired a config gate on filenames mentioned in their bodies; a deployment
// listing plus quoted "deploy" prose claimed a deploy). The same shape a
// command gate strips before judging.

// Drop heredoc bodies: from a line carrying `<<TAG` (also `<<-TAG`, quoted
// tags) through the terminating line `TAG`. Head lines are kept verbatim so
// the redirect target (`cat > <target> <<EOF`) is still judged. `<<<`
// herestrings carry their word on the same line and are left alone (the
// quote strip below handles their prose).
export const stripHeredocBodies = (command) => {
  const lines = String(command ?? '').split('\n');
  const kept = [];
  let pending = [];
  for (const line of lines) {
    if (pending.length > 0) {
      if (pending[0] === line.trim()) pending.shift();
      continue;
    }
    const tags = [];
    const re = /<<(?![<])-?~?\s*['"]?([A-Za-z_]\w*)['"]?/g;
    let m;
    while ((m = re.exec(line)) !== null) tags.push(m[1]);
    if (tags.length > 0) pending.push(...tags);
    kept.push(line);
  }
  return kept.join('\n');
};

// Remove single- and double-quoted spans, leaving a space so adjacent tokens
// cannot glue into a false one. Spans may cross newlines (`VAR='line1\nline2'`
// is one shell word). The opening quote must follow `=`, whitespace, a shell
// operator, or the start, so English apostrophes (`don't`, `session's`) are
// never treated as string opens.
export const stripQuoted = (text) =>
  String(text ?? '').replace(
    /(?<=[=\s([{;&|<>$`'"]|^)'(?:[^'\\]|\\.)*'|(?<=[=\s([{;&|<>$`'"]|^)"(?:[^"\\]|\\.)*"/gs,
    ' ',
  );

// The quote that may open a span: `=`, whitespace, a shell operator, or the
// start. Same gate as stripQuoted, so an apostrophe never opens.
const QUOTE_OPEN_PRECEDER = /[=\s([{;&|<>$`'"]/;

// Split a command into segments the way the guards judge them: one segment,
// one verdict, so a read in one segment neither fires for nor hides behind
// another. Quote-aware: separators inside a quoted span (`VAR='a && b'`, a
// `send-text "…; …"` message) do not split, and a multiline quoted span
// stays one segment. An unbalanced quote is treated as a literal, so it can
// never swallow the rest of the command.
export const splitSegments = (command) => splitSegmentsDetailed(command).map((s) => s.text);

// splitSegments plus the operator that PRECEDES each segment ('' for the
// first, else one of `|`, `||`, `&&`, `;`, `&`, newline). A gate that must
// know whether a command's stdin is a pipe reads `sep === '|'`; everyone
// else uses splitSegments.
export const splitSegmentsDetailed = (command) => {
  const text = String(command ?? '');
  const segs = [];
  let cur = '';
  let sep = '';
  const push = (next) => {
    segs.push({ text: cur, sep });
    cur = '';
    sep = next;
  };
  const findClose = (q, from) => {
    for (let j = from; j < text.length; j++) {
      const c = text[j];
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === q) return j;
    }
    return -1;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (
      (c === "'" || c === '"') &&
      (i === 0 || QUOTE_OPEN_PRECEDER.test(text[i - 1]))
    ) {
      const close = findClose(c, i + 1);
      if (close < 0) {
        cur += c;
        i++;
        continue;
      }
      cur += text.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    if (c === '\\' && i + 1 < text.length) {
      cur += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if ((c === '&' || c === '|') && text[i + 1] === c) {
      push(c + c);
      i += 2;
      continue;
    }
    // `2>&1`, `&>file`, `>&2`: an `&` that belongs to a redirection is not a
    // separator. Before this, `cmd 2>&1` split into `cmd 2>` and `1`.
    if (c === '&' && (text[i - 1] === '>' || text[i + 1] === '>')) {
      cur += c;
      i++;
      continue;
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      push(c);
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  push('');
  return segs;
};

// Split one segment into shell words. Single quotes are literal, double quotes
// honour backslash escapes, a bare backslash escapes the next character. A
// quoted span keeps its contents verbatim, `$(…)` and all: the guards that
// read a word's VALUE (a commit message, a --model name) decide themselves
// what an unexpanded `$` means. An unbalanced quote runs to the end, which is
// the allow-biased reading: the word it swallows is never mistaken for a flag.
export const shellWords = (segment) => {
  const text = String(segment ?? '');
  const words = [];
  let cur = null;
  let i = 0;
  const add = (s) => {
    cur = (cur ?? '') + s;
  };
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (cur !== null) words.push(cur);
      cur = null;
      i++;
      continue;
    }
    if (c === "'") {
      const close = text.indexOf("'", i + 1);
      const end = close < 0 ? text.length : close;
      add(text.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && /["\\$`]/.test(text[j + 1] ?? '')) {
          s += text[j + 1];
          j += 2;
          continue;
        }
        s += text[j];
        j++;
      }
      add(s);
      i = j + 1;
      continue;
    }
    if (c === '\\' && i + 1 < text.length) {
      add(text[i + 1]);
      i += 2;
      continue;
    }
    add(c);
    i++;
  }
  if (cur !== null) words.push(cur);
  return words;
};

// Words that may precede the real command in a segment without being it.
const PREFIX_WORDS = new Set(['sudo', 'command', 'exec', 'nohup', 'time', 'then', 'do', 'else', '!', '{', '(']);
const ASSIGNMENT_RE = /^[A-Za-z_]\w*=/;

// Where the command word sits in a segment's words: past `NAME=value`
// assignments, `env`, `sudo`, `timeout <duration>` and the other PREFIX_WORDS.
// Returns { index, env } where env holds the assignments seen (a guard can
// read `LEFTHOOK=0` off it), or index -1 when the segment is only prefixes.
export const commandStart = (words) => {
  const env = {};
  let i = 0;
  while (i < words.length) {
    const w = words[i].replace(/^[({]+/, '');
    if (w === '') {
      i++;
      continue;
    }
    if (ASSIGNMENT_RE.test(w)) {
      const eq = w.indexOf('=');
      env[w.slice(0, eq)] = w.slice(eq + 1);
      i++;
      continue;
    }
    if (w === 'env' || PREFIX_WORDS.has(w)) {
      i++;
      continue;
    }
    if (w === 'timeout') {
      i++;
      while (i < words.length && /^(-\S+|\d+(\.\d+)?[smhd]?)$/.test(words[i])) i++;
      continue;
    }
    return { index: i, env };
  }
  return { index: -1, env };
};

// The command word of a segment with its leading `(`/`{` removed, or ''.
export const commandWord = (words) => {
  const { index } = commandStart(words);
  return index < 0 ? '' : words[index].replace(/^[({]+/, '');
};

// Heredoc bodies in the RAW command, one entry per `<<TAG`, in order: the
// head line that opened it and the body lines up to the terminator. Mirrors
// stripHeredocBodies, which drops exactly these lines; a gate that has to
// READ a body (a message passed as `-F - <<EOF` or `-m "$(cat <<EOF)"`)
// pairs a segment with the entry whose head line carries it.
export const heredocBodies = (command) => {
  const lines = String(command ?? '').split('\n');
  const out = [];
  let pending = [];
  for (const line of lines) {
    if (pending.length > 0) {
      const cur = pending[0];
      if (cur.tag === line.trim()) {
        out.push({ head: cur.head, tag: cur.tag, body: cur.body.join('\n') });
        pending.shift();
      } else {
        cur.body.push(line);
      }
      continue;
    }
    const re = /<<(?![<])-?~?\s*['"]?([A-Za-z_]\w*)['"]?/g;
    let m;
    while ((m = re.exec(line)) !== null) pending.push({ head: line, tag: m[1], body: [] });
  }
  for (const cur of pending) out.push({ head: cur.head, tag: cur.tag, body: cur.body.join('\n') });
  return out;
};
// Is the text at `index` an actual command, or is it sitting inside a quoted
// string or a comment? Shared by gates that refuse a command string: without
// this a gate refuses an `echo` of a command in quotes, which does nothing —
// and refuses the very shell calls used to diagnose that. A blocking gate that
// rejects a command with no effect teaches people to route around it, so
// quote-awareness is load-bearing, not polish.
//
// This is a scanner, not a shell parser. It tracks single quotes, double quotes
// and backslash escapes, and treats an unquoted `#` as a comment to end of
// line. Anything it cannot decide it calls "not a command", because the bias of
// every gate using it is toward allowing.
export const atCommandPosition = (command, index) => {
  let single = false;
  let double = false;
  let comment = false;
  for (let i = 0; i < index; i += 1) {
    const c = command[i];
    if (comment) {
      if (c === '\n') comment = false;
      continue;
    }
    if (c === '\\' && !single) {
      i += 1;
      continue;
    }
    if (c === "'" && !double) single = !single;
    else if (c === '"' && !single) double = !double;
    else if (c === '#' && !single && !double && (i === 0 || /\s/.test(command[i - 1]))) comment = true;
  }
  return !single && !double && !comment;
};

export const matchesAtCommandPosition = (command, re) => {
  re.lastIndex = 0;
  for (let m = re.exec(command); m !== null; m = re.exec(command)) {
    if (atCommandPosition(command, m.index)) return true;
  }
  return false;
};

// Stricter than matchesAtCommandPosition: the match must also BE the command
// of its segment, with only assignments and prefix words (`sudo`, `env`,
// `timeout 30`, …) before it. `echo deploy …` carries the verb unquoted
// but runs `echo`, and a deny gate that refused it blocked a command with no
// effect. Judged per segment of the heredoc-stripped command, so
// `cd x && deploy` still matches.
export const matchesAsCommand = (command, re) =>
  splitSegments(stripHeredocBodies(command)).some((segment) => {
    re.lastIndex = 0;
    for (let m = re.exec(segment); m !== null; m = re.exec(segment)) {
      if (atCommandPosition(segment, m.index) && commandStart(shellWords(segment.slice(0, m.index))).index === -1) {
        return true;
      }
    }
    return false;
  });
