#!/usr/bin/env python3
"""Replace only the Azure Ubuntu archive on a GitHub-hosted Ubuntu 24.04 runner."""
import argparse
import os
from pathlib import Path
import re
import shlex

TARGETS = ('etc/apt/apt-mirrors.txt', 'etc/apt/sources.list',
           'etc/apt/sources.list.d/ubuntu.sources')
AZURE = re.compile(r'(?<!\S)(https?://)azure\.archive\.ubuntu\.com(/ubuntu/?)(?=\s|$)')


def validate_runner(root, environ):
    required = {'GITHUB_ACTIONS': 'true', 'RUNNER_OS': 'Linux',
                'RUNNER_ENVIRONMENT': 'github-hosted', 'ImageOS': 'ubuntu24'}
    if any(environ.get(key) != value for key, value in required.items()):
        raise ValueError('Only GitHub-hosted Ubuntu 24.04 runners are supported')
    release = {}
    for line in (root / 'etc/os-release').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            parsed = shlex.split(value)
            release[key] = parsed[0] if len(parsed) == 1 else ''
    if release.get('ID') != 'ubuntu' or release.get('VERSION_ID') != '24.04':
        raise ValueError('Runner OS must be Ubuntu 24.04')


def replace_archive(text, kind):
    """Preserve comments, non-URI fields and every other repository byte."""
    result = []
    count = 0
    uri_field = False
    for line in text.splitlines(keepends=True):
        active, separator, comment = line.partition('#')
        if kind == 'ubuntu.sources':
            if not active.strip():
                uri_field = False
            elif not active[0].isspace():
                uri_field = active.startswith('URIs:')
            eligible = uri_field
        elif kind == 'sources.list':
            eligible = bool(re.match(r'^\s*deb(?:-src)?\s', active))
        else:
            eligible = bool(re.match(r'^\s*https?://', active))
        if eligible:
            active, changes = AZURE.subn(r'\1archive.ubuntu.com\2', active)
            count += changes
        result.append(active + separator + comment)
    return ''.join(result), count


def repair_sources(root, environ):
    root = Path(root).absolute()
    if root.is_symlink():
        raise ValueError('Symlink root refused')
    validate_runner(root, environ)
    changes = []
    # Preflight all supported files before writing any of them.
    for name in TARGETS:
        path = root / name
        if any(parent.is_symlink() for parent in [path, *path.parents] if parent != root and root in parent.parents):
            raise ValueError('Symlink source refused: ' + name)
        if not path.exists():
            continue
        if not path.is_file():
            raise ValueError('APT source must be a file: ' + name)
        before = path.read_bytes().decode('utf-8')
        after, count = replace_archive(before, path.name)
        if count:
            changes.append((path, name, after, count))
    for path, _, after, _ in changes:
        path.write_bytes(after.encode('utf-8'))
    return [{'path': name, 'replacements': count} for _, name, _, count in changes]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/'), help='Filesystem root; alternate roots support synthetic tests')
    args = parser.parse_args()
    changes = repair_sources(args.root, os.environ)
    if not changes:
        print('Ubuntu archive source already needs no Azure replacement.')
    for change in changes:
        print('Ubuntu archive source: {path} ({replacements} replacements)'.format(**change))


if __name__ == '__main__':
    main()
