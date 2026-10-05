const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const serverFile = path.join(root, 'server', 'portal-diagnostics.js');
const htmlFile = path.join(root, 'dist', 'index.html');
const sourceHtml = path.join(root, 'index.html');

if (!fs.existsSync(serverFile) || !fs.existsSync(htmlFile)) {
  throw Error('Apply the CET Momentum 1.8.1 update first.');
}

let server = fs.readFileSync(serverFile, 'utf8');
if (!server.includes("'race.diagnostics'")) {
  if (!server.includes('const events=new Set([')) {
    throw Error('Unexpected diagnostic source. No files changed.');
  }
  server = server.replace(
    'const events=new Set([',
    "const events=new Set(['race.diagnostics',"
  );
}

const html = fs.readFileSync(htmlFile, 'utf8');
if (!html.includes('</head>')) {
  throw Error('Unexpected portal HTML. No files changed.');
}

function raceDiagnostics() {
  let currentCar = null, active = null, lastRun = 0;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const prefix = location.pathname.replace(/\/$/, '');

  function inspect(car) {
    const s = getComputedStyle(car);
    return {
      name: s.animationName,
      duration: s.animationDuration,
      delay: s.animationDelay,
      state: s.animationPlayState,
      transform: s.transform
    };
  }

  function keyframesPresent() {
    let unreadable = 0, found = false;
    function scan(rules) {
      for (const rule of rules) {
        if (rule.name === 'race-arrive') found = true;
        if (rule.cssRules) scan(rule.cssRules);
      }
    }
    for (const sheet of document.styleSheets) {
      try { scan(sheet.cssRules); }
      catch { unreadable++; }
    }
    return { found, unreadable };
  }

  function begin(car) {
    if (active || Date.now() - lastRun < 10000) return;
    lastRun = Date.now();

    const first = inspect(car);
    active = {
      car, first, starts: 0, ends: 0,
      cancels: 0, moved: false
    };
    const run = active;

    const sample = () => {
      if (car.isConnected &&
          inspect(car).transform !== first.transform) {
        run.moved = true;
      }
    };

    const timers = [300, 900, 1800, 3300]
      .map(ms => setTimeout(sample, ms));

    setTimeout(async () => {
      timers.forEach(clearTimeout);
      sample();

      const animated = run.starts > 0 || run.moved;
      const result = motion.matches
        ? 'reduced_motion_requested'
        : !car.isConnected
        ? 'car_replaced_during_check'
        : document.visibilityState !== 'visible'
        ? 'tab_hidden_result_inconclusive'
        : first.name === 'none'
        ? 'car_animation_disabled_or_style_missing'
        : first.state === 'paused'
        ? 'animation_paused'
        : animated
        ? 'animation_activity_observed'
        : 'no_activity_observed';

      const details = {
        result,
        reducedMotion: motion.matches,
        visibility: document.visibilityState,
        cars: document.querySelectorAll('.race-car').length,
        keyframes: keyframesPresent(),
        name: first.name.slice(0, 50),
        duration: first.duration,
        delay: first.delay,
        state: first.state,
        starts: run.starts,
        ends: run.ends,
        cancels: run.cancels,
        moved: run.moved,
        css: [...document.querySelectorAll('link[rel="stylesheet"]')]
          .map(l => new URL(l.href).pathname)
          .join(',').slice(0, 120),
        browser: navigator.userAgent.slice(0, 100)
      };

      active = null;
      try {
        await fetch(prefix + '/api/client-errors', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'race.diagnostics',
            page: location.pathname,
            message: JSON.stringify(details)
          })
        });
      } catch {
        // A reporting failure must not interrupt the race.
      }
    }, 4800);
  }

  function check() {
    const car = document.querySelector('.view-race .race-car');
    if (!car) {
      currentCar = null;
      return;
    }
    if (car !== currentCar) {
      currentCar = car;
      begin(car);
    }
  }

  for (const event of [
    'animationstart', 'animationend', 'animationcancel'
  ]) {
    document.addEventListener(event, e => {
      if (!e.target.matches?.('.race-car') ||
          e.animationName !== 'race-arrive') return;

      if (event === 'animationstart') begin(e.target);
      if (!active) return;

      if (event === 'animationstart') active.starts++;
      if (event === 'animationend') active.ends++;
      if (event === 'animationcancel') active.cancels++;
    }, true);
  }

  function start() {
    new MutationObserver(check).observe(document.body, {
      childList: true, subtree: true
    });
    check();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}

const code = '(' + raceDiagnostics.toString() + ')();\n';
const tag = '<script src="./race-diagnostics.js" defer></script>';
const inject = value =>
  value.includes('src="./race-diagnostics.js"')
    ? value
    : value.replace('</head>', tag + '</head>');

for (const file of [serverFile, htmlFile, sourceHtml]) {
  if (fs.existsSync(file) &&
      !fs.existsSync(file + '.before-race-diagnostics')) {
    fs.copyFileSync(file, file + '.before-race-diagnostics');
  }
}

fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.writeFileSync(serverFile, server);
fs.writeFileSync(path.join(root, 'dist', 'race-diagnostics.js'), code);
fs.writeFileSync(path.join(root, 'public', 'race-diagnostics.js'), code);
fs.writeFileSync(htmlFile, inject(html));

if (fs.existsSync(sourceHtml)) {
  fs.writeFileSync(
    sourceHtml,
    inject(fs.readFileSync(sourceHtml, 'utf8'))
  );
}

console.log('Race diagnostics added. Restart CET Momentum.');
console.log('Open CET Race, then check storage/logs/portal.log.');