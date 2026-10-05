"""Shared, read-only structural and staging helpers; no publishing or license decisions."""
import hashlib
import json
import math
import pathlib
import re

SCHEMA_VERSION = 2
SCOPE = 'Structural consistency only; no publishing authorization, visual, license or Core compatibility approval'
KNOWN_MOTION_LABELS = {
    'idle': '自然站立（待机）', 'blink': '眨眼', 'nod': '点头', 'shake': '摇头'
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode()


def parse_json(data, label):
    def invalid_constant(value):
        raise ValueError('Non-finite JSON number: ' + value)
    try:
        return json.loads(data, parse_constant=invalid_constant)
    except (ValueError, UnicodeError) as error:
        raise ValueError(f'Invalid JSON {label}: {error}') from error


def safe(name, directory=False):
    if not isinstance(name, str) or not name or any(c in name for c in '\\:?#\x00'):
        raise ValueError(f'Invalid local path: {name!r}')
    plain = name[:-1] if directory and name.endswith('/') else name
    path = pathlib.PurePosixPath(plain)
    if path.is_absolute() or '..' in path.parts or not path.parts or str(path) != plain:
        raise ValueError(f'Unsafe local path: {name!r}')
    if not directory and name.endswith('/'):
        raise ValueError(f'Expected a file path: {name!r}')
    return path


def no_symlinks(path):
    path = pathlib.Path(path).absolute()
    for item in [path, *path.parents]:
        if item.is_symlink():
            raise ValueError(f'Symlink is not allowed: {item}')
    return path.resolve(strict=False)


def local_file(root, name):
    relative = safe(name)
    path = no_symlinks(pathlib.Path(root) / relative)
    if not path.is_file():
        raise ValueError(f'Missing file: {name}')
    return path


def snapshot(directory):
    root = no_symlinks(directory)
    if not root.is_dir():
        raise ValueError(f'Missing resource directory: {root}')
    result = {}
    for path in sorted(root.rglob('*')):
        no_symlinks(path)
        if path.is_file():
            result[path.relative_to(root).as_posix()] = digest(path.read_bytes())
        elif not path.is_dir():
            raise ValueError(f'Unsupported resource entry: {path}')
    return result


def registry_state(plugin_root, slug):
    root = no_symlinks(plugin_root)
    raw = local_file(root, 'characters.json').read_bytes()
    registry = parse_json(raw, 'characters.json')
    if not isinstance(registry, dict):
        raise ValueError('Registry JSON root must be an object')
    old = registry.get(slug)
    if slug in registry and not isinstance(old, dict):
        raise ValueError('Existing character configuration must be an object')
    if old is not None and (not isinstance(old.get('root'), str) or not old['root'].endswith('/')):
        raise ValueError('Existing character root must end with /')
    previous = snapshot(root / safe(old.get('root'), directory=True)) if old is not None else None
    return raw, registry, old, previous


def validate(directory, model_file, config=None, allow_extra=False):
    errors = []
    root = pathlib.Path(directory)

    def fail(message):
        errors.append(message)

    def local(name):
        try:
            return local_file(root, name)
        except (ValueError, OSError) as error:
            fail(str(error))
            return None

    def read(name):
        path = local(name)
        if path:
            try:
                value = parse_json(path.read_bytes(), name)
                if not isinstance(value, dict):
                    raise ValueError(f'JSON root must be an object: {name}')
                return value
            except (ValueError, OSError) as error:
                fail(str(error))
        return {}

    def list_field(value, label):
        if not isinstance(value, list):
            fail(f'{label} must be a list')
            return []
        return value

    def object_field(value, label):
        if not isinstance(value, dict):
            fail(f'{label} must be an object')
            return {}
        return value

    if not isinstance(model_file, str) or not model_file.endswith('.model3.json'):
        fail('Expected real model3.json format; renaming legacy formats is not conversion')
    model = read(model_file)
    refs = object_field(model.get('FileReferences'), 'FileReferences')
    if type(model.get('Version')) is not int or model['Version'] != 3:
        fail('Expected manifest Version 3')
    moc = local(refs.get('Moc'))
    if moc:
        try:
            if moc.read_bytes()[:4] != b'MOC3':
                fail('Moc header is not MOC3')
        except OSError as error:
            fail(str(error))
    textures = list_field(refs.get('Textures'), 'FileReferences.Textures')
    if not textures:
        fail('No textures')
    for name in textures:
        local(name)
    for key in ['Physics', 'Pose', 'UserData', 'DisplayInfo']:
        if key in refs:
            read(refs[key])
    manifest = {'motions': set(), 'expressions': set()}
    groups = object_field(refs.get('Motions', {}), 'FileReferences.Motions')
    for group, items in groups.items():
        if not isinstance(group, str) or not group:
            fail('Motion group must be a nonempty string')
        for item in list_field(items, f'Motion group {group}'):
            item = object_field(item, f'Motion item in {group}')
            name = item.get('File')
            if isinstance(name, str):
                manifest['motions'].add(name)
            read(name)
            if 'Sound' in item:
                fail(f'Audio Sound reference remains: {name}')
    for item in list_field(refs.get('Expressions', []), 'FileReferences.Expressions'):
        item = object_field(item, 'Expression item')
        name = item.get('File')
        if isinstance(name, str):
            manifest['expressions'].add(name)
        read(name)
        if not isinstance(item.get('Name'), str) or not item['Name']:
            fail('Expression requires a nonempty Name')
    catalog = read('catalog.json')
    motion_ids = set()
    for kind in ['motions', 'expressions']:
        seen = set()
        for item in list_field(catalog.get(kind), f'catalog.{kind}'):
            item = object_field(item, f'catalog.{kind} item')
            ident, name = item.get('id'), item.get('file')
            if not isinstance(ident, str) or not ident or ident in seen:
                fail(f'Invalid/duplicate {kind} ID: {ident!r}')
            else:
                seen.add(ident)
            read(name)
            if isinstance(name, str) and name not in manifest[kind] and not allow_extra:
                fail(f'{kind} catalog file absent from manifest: {name}')
            if not isinstance(item.get('label'), str) or not item['label'].strip():
                fail(f'Missing/invalid label: {ident!r}')
        if kind == 'motions':
            motion_ids = seen
    if config is not None:
        if not isinstance(config, dict):
            fail('Configuration JSON root must be an object')
        else:
            for key in ['name', 'root', 'file', 'idle']:
                if not isinstance(config.get(key), str) or not config[key].strip():
                    fail(f'Configuration {key} must be a nonempty string')
            for key in ['root', 'file']:
                try:
                    safe(config.get(key), directory=key == 'root')
                except ValueError as error:
                    fail(f'Configuration {key}: {error}')
            if isinstance(config.get('root'), str) and not config['root'].endswith('/'):
                fail('Configuration root must end with / for runtime URL concatenation')
            if config.get('file') != model_file:
                fail('Configuration manifest differs')
            greetings = list_field(config.get('greetings'), 'Configuration greetings')
            configured = [config.get('idle')]
            for ident in greetings:
                if not isinstance(ident, str) or not ident:
                    fail('Configuration greetings items must be nonempty strings')
                else:
                    configured.append(ident)
            welcome = config.get('welcome')
            if welcome is not None and not isinstance(welcome, str):
                fail('Configuration welcome must be a string or null')
            elif welcome:
                configured.append(welcome)
            for ident in configured:
                if not isinstance(ident, str) or ident not in motion_ids:
                    fail(f'Unknown configured motion: {ident!r}')
            for key in ['size', 'offset', 'renderScale', 'renderX', 'renderY']:
                if key not in config and key not in ['size', 'offset']:
                    continue
                value = config.get(key)
                try:
                    finite = type(value) in [int, float] and math.isfinite(value)
                except OverflowError:
                    finite = False
                if not finite:
                    fail(f'Configuration {key} must be a finite number')
                elif key == 'size' and not 140 <= value <= 260:
                    fail('Configuration size must be in range 140..260')
                elif key == 'renderScale' and value <= 0:
                    fail('Configuration renderScale must be positive')
            if 'webgl2' in config and type(config['webgl2']) is not bool:
                fail('Configuration webgl2 must be boolean')
            for key in ['credit', 'termsAnchor']:
                if key in config and not isinstance(config[key], str):
                    fail(f'Configuration {key} must be a string')
    return {'ok': not errors, 'errors': errors, 'scope': SCOPE}


def catalog_object(value):
    if not isinstance(value, dict):
        raise ValueError('Catalog JSON root must be an object')
    for kind in ['motions', 'expressions']:
        if not isinstance(value.get(kind), list):
            raise ValueError(f'catalog.{kind} must be a list')
        seen = set()
        for item in value[kind]:
            if not isinstance(item, dict):
                raise ValueError(f'catalog.{kind} item must be an object')
            ident = item.get('id')
            if not isinstance(ident, str) or not ident or ident in seen:
                raise ValueError(f'Invalid/duplicate {kind} ID: {ident!r}')
            seen.add(ident)
            safe(item.get('file'))
            if not isinstance(item.get('label'), str) or not item['label'].strip():
                raise ValueError(f'Invalid {kind} label: {ident!r}')
    return value


def review_summary(previous_config, config, old_catalog, catalog, previous_hashes, hashes, mode):
    before = previous_hashes or {}
    files = {
        'added': sorted(hashes.keys() - before.keys()),
        'changed': sorted(name for name in hashes.keys() & before.keys() if hashes[name] != before[name]),
        'removed': sorted(before.keys() - hashes.keys()),
        'removedMeaning': 'Absent from candidate runtime; never an instruction to delete old resources',
        'retainedExtraFiles': sorted(before.keys() - hashes.keys()) if mode == 'noop' else [],
    }
    old_config = previous_config or {}
    config_changes = [
        {'field': key, 'beforePresent': key in old_config, 'before': old_config.get(key),
         'afterPresent': key in config, 'after': config.get(key)}
        for key in sorted(old_config.keys() | config.keys())
        if (key in old_config) != (key in config) or old_config.get(key) != config.get(key)
    ]
    review = {'files': files, 'config': config_changes}
    for kind in ['motions', 'expressions']:
        old_items = {item['id']: item for item in old_catalog.get(kind, [])}
        items = {item['id']: item for item in catalog[kind]}
        shared = old_items.keys() & items.keys()
        review[kind] = {
            'added': sorted(items.keys() - old_items.keys()),
            'removed': sorted(old_items.keys() - items.keys()),
            'mappingChanged': [
                {'id': ident, 'beforeFile': old_items[ident]['file'], 'afterFile': items[ident]['file']}
                for ident in sorted(shared) if old_items[ident]['file'] != items[ident]['file']
            ],
            'contentChanged': [
                {'id': ident, 'beforeFile': old_items[ident]['file'], 'afterFile': items[ident]['file'],
                 'beforeSha256': before.get(old_items[ident]['file']), 'afterSha256': hashes.get(items[ident]['file'])}
                for ident in sorted(shared)
                if before.get(old_items[ident]['file']) != hashes.get(items[ident]['file'])
            ],
            'labelChanged': [
                {'id': ident, 'before': old_items[ident]['label'], 'after': items[ident]['label']}
                for ident in sorted(shared) if old_items[ident]['label'] != items[ident]['label']
            ],
            'unknownActions': sorted(ident for ident in items.keys() - old_items.keys()
                                     if kind == 'expressions' or ident not in KNOWN_MOTION_LABELS),
        }
    welcome = config.get('welcome')
    old_welcome = old_config.get('welcome')
    changed_ids = {item['id'] for key in ['mappingChanged', 'contentChanged'] for item in review['motions'][key]}
    welcome_pending = bool(welcome) and (not previous_config or welcome != old_welcome or welcome in changed_ids)
    review['welcome'] = {
        'before': old_welcome, 'after': welcome, 'visualConfirmationRequired': welcome_pending,
        'status': 'pending' if welcome_pending else ('disabled' if not welcome else 'unchanged'),
        'note': 'Nod is a default candidate only; names and structure do not prove suitable welcome behavior',
    }
    review['source'] = {'kind': 'user-stated self-created AIGC model', 'licenseAuthorizationVerified': False,
                        'note': 'Authorship statement only; no permission or open-source license inferred'}
    review['capability'] = {'webgl2Declared': config.get('webgl2', False), 'compatibilityTested': False,
                            'note': 'Configuration declaration only; no Core/WebGL compatibility test performed'}
    return review
