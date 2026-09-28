#!/bin/sh
# The neutral project every v1 session shot runs in. Usage: demo-project.sh <folder>
# The folder comes from onboarding's "Start fresh…" (~/Documents/HappyVibe/lemonade-stand).
set -eu
cd "$1"
cat > index.html <<'EOF'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Lemonade Stand</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <h1>Lemonade Stand</h1>
  <p>Fresh lemonade, squeezed to order.</p>
  <ul>
    <li>Classic — 2.00</li>
    <li>Mint — 2.50</li>
  </ul>
</body>
</html>
EOF
cat > style.css <<'EOF'
body { font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 32rem; background: #fffbe6; color: #3b3000; }
h1 { color: #d49b00; }
EOF
printf '# Lemonade Stand\n\nA one-page site for a neighbourhood lemonade stand.\n' > README.md
mkdir -p scripts
# Takes a few seconds on purpose, so session-running can catch a command card mid-run.
printf '#!/bin/sh\necho "Checking index.html…"\nsleep 5\necho "All links OK."\n' > scripts/check.sh
chmod +x scripts/check.sh
git init -q
git add -A
git -c user.name=Demo -c user.email=demo@localhost commit -qm "First version"
echo "demo project ready in $1"
