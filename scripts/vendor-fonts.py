"""Download the two OFL font families into the app so it works fully offline."""
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'fonts'
OUT.mkdir(parents=True, exist_ok=True)
css = []
for family, slug, repository in [('DM Sans', 'dm-sans', 'dmsans'), ('Manrope', 'manrope', 'manrope')]:
    query = family.replace(' ', '+')
    url = f'https://fonts.googleapis.com/css2?family={query}:wght@400..800&display=swap'
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'})
    response = urllib.request.urlopen(request).read().decode()
    # The final font-face in Google's stylesheet is the Latin subset.
    block = re.findall(r'@font-face\s*\{[^}]+\}', response)[-1]
    source = re.search(r'url\(([^)]+)\)', block).group(1)
    suffix = source.split('.')[-1]
    filename = f'{slug}.{suffix}'
    (OUT / filename).write_bytes(urllib.request.urlopen(source).read())
    css.append(block.replace(source, f'/fonts/{filename}'))
    license_url = f'https://raw.githubusercontent.com/google/fonts/main/ofl/{repository}/OFL.txt'
    (OUT / f'{slug}-OFL.txt').write_bytes(urllib.request.urlopen(license_url).read())
sheet = ROOT / 'src' / 'app.css'
text = sheet.read_text(encoding='utf-8')
text = re.sub(r'@import url\([^)]*\);', lambda _: '\n\n'.join(css), text, count=1)
sheet.write_text(text, encoding='utf-8')
print('Vendored DM Sans and Manrope with their OFL licenses.')
