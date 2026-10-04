"""Local help regression experiment; no agents, network, or provider cache claims."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def snapshot(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


baseline, candidate, output = map(Path, sys.argv[1:4])
runs = []
with tempfile.TemporaryDirectory(prefix='yoke-help-comparison-') as temporary:
    experiment = Path(temporary)
    for pair in range(1, 4):
        targets = {}
        for label in ('baseline', 'candidate'):
            root = experiment / str(pair) / label
            root.mkdir(parents=True)
            (root / 'package.json').write_text('{"name":"help-probe","private":true}')
            (root / 'user.txt').write_text('preserve me')
            targets[label] = root
        for condition in ('fresh-target', 'repeat-target'):
            order = ('baseline', 'candidate') if pair % 2 else ('candidate', 'baseline')
            for label in order:
                source = baseline if label == 'baseline' else candidate
                target = targets[label]
                before = snapshot(target)
                # Import the public dispatch function to exclude the CLI's external
                # update-notifier side effect equally from both versions.
                program = 'const {main}=await import(process.argv[1]); process.exitCode=await main(["setup",process.argv[2],"--help","--yes","--host=codex"]);'
                start = time.perf_counter()
                result = subprocess.run(['node', '--input-type=module', '-e', program,
                                         (source / 'dist/cli.js').as_uri(), str(target)],
                                        capture_output=True, timeout=60)
                elapsed = (time.perf_counter() - start) * 1000
                after = snapshot(target)
                changed = sorted(p for p in before.keys() | after.keys() if before.get(p) != after.get(p))
                assert result.returncode == 0, result.stderr.decode(errors='replace')
                assert after['user.txt'] == before['user.txt']
                if label == 'candidate':
                    assert not changed, changed
                runs.append(dict(pair=pair, condition=condition, version=label,
                                 milliseconds=round(elapsed, 3), changedFiles=len(changed),
                                 exitCode=result.returncode))
report = {'method': '3 paired fresh/repeated target help calls per version, alternating order; each call starts a new Node process',
          'limits': 'Not OS/provider/npm cold/warm cache measurements; no LLM, guardian, approval or full-product speed/cost inference. File reads for snapshots are outside timed calls.',
          'baseline': str(baseline), 'candidate': str(candidate), 'runs': runs}
output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
