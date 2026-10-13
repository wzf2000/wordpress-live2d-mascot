#!/usr/bin/env python3
"""Reproduce gettext POT/MO and check owned UI coverage, using only Python stdlib."""
import argparse
import ast
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[1]
LANG = ROOT / 'plugin/languages'
LITERAL = r'''(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")'''


def messages():
    result = {}
    for path in [ROOT / 'plugin/live2d-show.php', *sorted((ROOT / 'plugin/includes').glob('*.php'))]:
        text = path.read_text()
        for match in re.finditer(r'\b(?:__|esc_html__|esc_attr__)\(\s*(' + LITERAL + r")\s*,\s*'live2d-show'\s*\)", text):
            result[ast.literal_eval(match[1])] = None
        for match in re.finditer(r'\b_n\(\s*(' + LITERAL + r')\s*,\s*(' + LITERAL + ')', text):
            result[ast.literal_eval(match[1])] = ast.literal_eval(match[2])
    return result


def po_text(entries, locale=None):
    header = 'Project-Id-Version: WordPress Live2D Mascot\nContent-Type: text/plain; charset=UTF-8\n'
    if locale:
        header += 'Language: ' + locale + '\nPlural-Forms: ' + ('nplurals=1; plural=0;' if locale == 'zh_CN' else 'nplurals=2; plural=(n != 1);') + '\n'
    quote = lambda value: json.dumps(value, ensure_ascii=False)
    lines = ['# GPL-2.0-or-later. Generated template; edit locale PO translations.', 'msgid ""', 'msgstr ' + quote(header), '']
    for message, (plural, translations) in sorted(entries.items()):
        lines.append('msgid ' + quote(message))
        if plural is None:
            lines.append('msgstr ' + quote(translations[0] if translations else ''))
        else:
            lines.append('msgid_plural ' + quote(plural))
            for index in range(1 if locale == 'zh_CN' else 2):
                lines.append('msgstr[' + str(index) + '] ' + quote(translations[index] if translations else ''))
        lines.append('')
    return '\n'.join(lines).rstrip() + '\n'


def parse_po(path):
    entries = {}; current = {}; field = None
    def finish():
        if 'msgid' not in current: return
        if current['msgid'] in entries: raise ValueError('Duplicate PO entry')
        translations = [value for key, value in sorted(current.items()) if key.startswith('msgstr')]
        entries[current['msgid']] = (current.get('msgid_plural'), translations)
    for line in [*path.read_text().splitlines(), '']:
        if not line.strip(): finish(); current = {}; field = None
        elif line.startswith('#'): continue
        elif line.startswith('"'):
            if field is None: raise ValueError('Invalid PO continuation')
            current[field] += ast.literal_eval(line)
        else:
            match = re.fullmatch(r'(msgid|msgid_plural|msgstr(?:\[\d+\])?)\s+(".*")', line)
            if not match: raise ValueError('Unsupported PO syntax: ' + line)
            field = match[1]; current[field] = ast.literal_eval(match[2])
    return entries


def mo_bytes(entries):
    encoded = sorted((message.encode() + (b'\0' + plural.encode() if plural else b''), '\0'.join(translations).encode()) for message, (plural, translations) in entries.items())
    count = len(encoded); offset = 28 + 16 * count
    ids = b''; values = b''; id_rows = []; value_rows = []
    for message, _ in encoded:
        id_rows.append((len(message), offset + len(ids))); ids += message + b'\0'
    offset += len(ids)
    for _, value in encoded:
        value_rows.append((len(value), offset + len(values))); values += value + b'\0'
    return struct.pack('<7I', 0x950412de, 0, count, 28, 28 + 8 * count, 0, 0) + b''.join(struct.pack('<2I', *row) for row in id_rows + value_rows) + ids + values


def check_coverage():
    php = (ROOT / 'plugin/includes/i18n.php').read_text()
    available = {ast.literal_eval(match[1]) for match in re.finditer('(' + LITERAL + r')\s*=>\s*__\(', php)}
    loader = (ROOT / 'src/loader.js').read_text()
    required = {ast.literal_eval(match[1]) for match in re.finditer(r'\bt\(\s*(' + LITERAL + ')', loader)}
    # Engine/resource errors are translated at the loader display boundary.
    for name in ['engine.ts', 'resources.ts']:
        required |= {ast.literal_eval(match[0]) for match in re.finditer(r'"(?:[^"\\]|\\.)*"', (ROOT / 'src' / name).read_text())}
    if not required <= available: raise ValueError('Missing frontend translations: ' + repr(sorted(required - available)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check template, complete locales and byte-for-byte MO reproducibility without writing')
    args = parser.parse_args()
    expected = messages()
    template = po_text({key: (plural, []) for key, plural in expected.items()})
    if args.check:
        if (LANG / 'live2d-show.pot').read_text() != template: raise ValueError('Translation template is stale')
    else:
        (LANG / 'live2d-show.pot').write_text(template)
    for locale in ['en_US', 'zh_CN']:
        entries = parse_po(LANG / ('live2d-show-' + locale + '.po'))
        if set(entries) != set(expected) | {''}: raise ValueError('Locale entry coverage differs: ' + locale)
        for message, plural in expected.items():
            actual_plural, values = entries[message]
            if actual_plural != plural or len(values) != (1 if not plural or locale == 'zh_CN' else 2) or not all(values): raise ValueError('Incomplete translation: ' + message)
            placeholders = lambda value: sorted(re.findall(r'%(?:[1-9]\d*\$)?[sd]', value))
            if any(placeholders(value) != placeholders(message) for value in values): raise ValueError('Translation placeholders differ: ' + message)
        compiled = mo_bytes(entries)
        target = LANG / ('live2d-show-' + locale + '.mo')
        if args.check:
            if target.read_bytes() != compiled: raise ValueError('Compiled MO differs: ' + locale)
        else: target.write_bytes(compiled)
    check_coverage()
    print('Owned UI gettext coverage and reproducible locales verified.')


if __name__ == '__main__': main()
