"""Adapt the preceding strict release selector without weakening its gates."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
p=ROOT/'scripts/finalize-rc17.py'
s=p.read_text().replace('rc16','rc17').replace('RC16','RC17').replace("VERSION = '1.3.0-rc.16'", "VERSION = '1.3.0-rc.17'")
s=s.replace('193ae2b1be926229478b41dad5abf6222e6c7ca2df5e7d53e04b34aa85ee064a','3b5d3b873b2f645409f3e503f41407b20b99ff2972379c84e77906a738a43587')
s=s.replace('unchanged delivered RC15 ASAR','unchanged delivered RC16 ASAR')
s=s.replace("{'avatars', 'workbook', 'migration', 'interactions'}","{'rules', 'migration', 'imports', 'classroom'}")
s=s.replace('Wrong six-finding closure schema/version','Wrong three-finding closure schema/version')
s=s.replace("[f'RC17-D{i:02d}' for i in range(1, 7)]","[f'RC17-D{i:02d}' for i in range(1, 4)]")
s=s.replace('The six confirmed defect families must each be closed exactly once','The three confirmed defect families must each be closed exactly once')
s=s.replace("            if finding['id'] == 'RC17-D03':\n                require(finding.get('repairIterations'), 'D03 must preserve the independently discovered setup mkdir retry subfinding')\n                require(finding.get('existingMalformedJournalRetained') is True and finding.get('limits'), 'D03 must disclose that malformed old RC15 journals require explicit recovery')\n", "            if finding['id'] == 'RC17-D01':\n                require(finding.get('repairIterations'), 'D01 must preserve the unpublished renderer-key integration regression and its subsequent review')\n")
s=s.replace("'newOptionalVersion2Fields': ['scoreRules[].growthDelta', 'logs[].growthDelta']","'newOptionalVersion2Fields': ['draw.eventId', 'drawSessions[*].eventId', 'petDraw.eventId'], 'version2MetadataNote': 'RC17 adds optional persisted identity metadata for ordinary draw, saved draw sessions, and pet draw. The classroom format remains version 2; reading legacy archives alone does not change them.'")
s=s.replace("'artifacts/reaudit-rc15'","'artifacts/reaudit-rc16'")
s=s.replace('original RC15 failures, successful defect-reproduction assertions','original RC16 failures, successful defect-reproduction observations')
s=s.replace('for the six defect families','for the three defect families')
s=s.replace("ended = row.get('completedAt', row.get('finishedAt'))","ended = row.get('completedAt') or row.get('finishedAt') or row.get('endedAt')")
s=s.replace("self.frozen_at <= start <= end", "max(self.frozen_at, timestamp('2026-10-07T03:12:00Z', 'audit start')) <= start <= end")
s=s.replace("        self.groups = []", "        require(self.frozen_at >= timestamp('2026-10-07T03:12:00Z', 'audit start'), 'Current freeze predates this audit')\n        self.groups = []")
s=s.replace("    if isinstance(value.get('checks'), list):", "    if isinstance(value.get('leaves'), list):\n        return [(pointer + '/leaves/' + str(i), {**item, 'name': (item.get('case', '') + ' / ' if item.get('case') else '') + item['name']}) for i, item in enumerate(value['leaves'])]\n    if isinstance(value.get('checks'), list):",1)
p.write_text(s)
print(p)
