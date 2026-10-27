/**
 * Postgres -> libSQL placeholder translator.
 *
 * The 33 data-access call sites are written against `$1, $2, ...` with a
 * positional params array. libSQL only understands `?`, so every statement is
 * passed through this scanner before execution.
 *
 * A regex cannot do this: the scanner must not touch `$1` inside string literals
 * or comments, and it must handle parameters used more than once
 * (`POS.tsx:298` sends `VALUES ($1,$2,$3,$4,$4,$5)`), where the value has to be
 * pushed into the args array twice to line up with the emitted `?`.
 */

export interface TranslatedQuery {
  sql: string;
  args: unknown[];
}

type State = 'normal' | 'single' | 'double' | 'line-comment' | 'block-comment';

/**
 * Rewrites `$n` placeholders to `?` and expands `params` in the order the
 * placeholders appear.
 */
export function translate(text: string, params: unknown[] = []): TranslatedQuery {
  let replaced = false;

  const result = scan(text, (position, digits) => {
    replaced = true;
    if (position < 1) {
      throw new Error(`Invalid placeholder $${digits} (placeholders are 1-based)`);
    }
    if (position > params.length) {
      throw new Error(
        `Placeholder $${digits} has no matching parameter (only ${params.length} supplied)`
      );
    }
    return params[position - 1];
  });

  // Statements that are already SQLite syntax (schema scripts, new code) pass
  // their params straight through: the scanner only collects `$n` values, so
  // returning its args would silently discard them.
  return replaced ? result : { sql: result.sql, args: params };
}

/**
 * The scanner behind `translate`. `resolve` is called once per `$n` occurrence
 * and its return value is pushed into the emitted args, which is what makes
 * repeated placeholders (`$4 … $4`) line up with the emitted `?`s.
 */
function scan(text: string, resolve: (position: number, digits: string) => unknown): TranslatedQuery {
  let state: State = 'normal';
  let sql = '';
  let index = 0;
  const args: unknown[] = [];

  while (index < text.length) {
    const char = text[index];

    switch (state) {
      case 'single': {
        sql += char;
        if (char === "'") {
          // '' is an escaped quote inside a literal
          if (text[index + 1] === "'") {
            sql += text[index + 1];
            index += 2;
            continue;
          }
          state = 'normal';
        }
        index += 1;
        continue;
      }

      case 'double': {
        sql += char;
        if (char === '"') {
          if (text[index + 1] === '"') {
            sql += text[index + 1];
            index += 2;
            continue;
          }
          state = 'normal';
        }
        index += 1;
        continue;
      }

      case 'line-comment': {
        sql += char;
        if (char === '\n') state = 'normal';
        index += 1;
        continue;
      }

      case 'block-comment': {
        sql += char;
        if (char === '*' && text[index + 1] === '/') {
          sql += '/';
          index += 2;
          state = 'normal';
          continue;
        }
        index += 1;
        continue;
      }

      default:
        break;
    }

    // ---- Normal state -----------------------------------------------------
    if (char === "'") {
      state = 'single';
      sql += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      state = 'double';
      sql += char;
      index += 1;
      continue;
    }

    if (char === '-' && text[index + 1] === '-') {
      state = 'line-comment';
      sql += '--';
      index += 2;
      continue;
    }

    if (char === '/' && text[index + 1] === '*') {
      state = 'block-comment';
      sql += '/*';
      index += 2;
      continue;
    }

    if (char === '$' && text[index + 1] >= '0' && text[index + 1] <= '9') {
      let cursor = index + 1;
      let digits = '';
      while (cursor < text.length && text[cursor] >= '0' && text[cursor] <= '9') {
        digits += text[cursor];
        cursor += 1;
      }

      const position = Number(digits);
      args.push(resolve(position, digits));
      sql += '?';
      index = cursor;
      continue;
    }

    sql += char;
    index += 1;
  }

  return { sql, args };
}

/** True when the statement still contains a Postgres-style placeholder. */
export function hasPostgresPlaceholders(text: string): boolean {
  return scan(text, () => undefined).sql !== text;
}
