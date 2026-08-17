/* ---------- Portfolio chart ---------- */
        const W = 720, H = 260, PL = 46, PR = 10, PT = 14, PB = 22;

        function genSeries(start, end, n) {
            const arr = [];
            for (let i = 0; i < n - 1; i++) {
                const t = i / (n - 1);
                const base = start + (end - start) * t;
                const wave = Math.sin(i * 1.7 + t * 6) * 0.004 * start;
                const r = (Math.random() - 0.5) * 0.0035 * start;
                arr.push(Math.round(base + wave + r));
            }
            arr.push(Math.round(end));
            return arr;
        }

        /* Series are rebuilt from the current balance (js/store.js getBalance()) so the
           chart follows admin changes. Each period starts at a fraction of the balance
           and climbs to it, so the curve reflects the account's own value. */
        const CHART_START = { '1D': 0.985, '1W': 0.96, '1M': 0.92, '1Y': 0.8, 'ALL': 0.55 };
        const PERIODS = {};

        function resyncChartSeries() {
            const end = getBalance();
            if (end <= 0) {
                // Empty account: flat zero line instead of a negative curve.
                Object.keys(CHART_START).forEach(k => { PERIODS[k] = Array(26).fill(0); });
                return;
            }
            Object.keys(CHART_START).forEach(k => { PERIODS[k] = genSeries(end * CHART_START[k], end, 26); });
        }
        resyncChartSeries();

        const PERIOD_LABELS = {
            '1D':  ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00','00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00','08:00','09:00','Now'],
            '1W':  ['Mon','Mon','Tue','Tue','Wed','Wed','Thu','Thu','Fri','Fri','Sat','Sat','Sun','Sun','Mon','Mon','Tue','Tue','Wed','Wed','Thu','Thu','Fri','Fri','Sat','Today'],
            '1M':  ['Jun 18','Jun 20','Jun 22','Jun 24','Jun 26','Jun 28','Jun 30','Jul 2','Jul 4','Jul 6','Jul 8','Jul 10','Jul 12','Jul 14','Jul 16','Jul 18','Jul 20','Jul 22','Jul 24','Jul 26','Jul 28','Jul 30','Aug 1','Aug 3','Aug 5','Aug 12'],
            '1Y':  ['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Now'],
            'ALL': ['2019','2019','2020','2020','2021','2021','2022','2022','2023','2023','2024','2024','2025','2025','2026','2026','2026','2026','2026','2026','2026','2026','2026','2026','2026','Now']
        };

        const PERIOD_SUB = {
            '1D': 'Last 24 hours', '1W': 'Last 7 days', '1M': 'Last 30 days', '1Y': 'Last 12 months', 'ALL': 'Since 2019'
        };

        function smoothPath(pts) {
            if (pts.length < 2) return '';
            let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
                const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
                const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
                d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
            }
            return d;
        }

        let ptsCache = [];
        let currentPeriod = '1D';

        function renderChart(period, btn) {
            currentPeriod = period;
            const values = PERIODS[period];
            const labels = PERIOD_LABELS[period];
            const n = values.length;

            const min = Math.min(...values), max = Math.max(...values);
            const pad = (max - min) * 0.12 || max * 0.02 || 1;
            const lo = min - pad, hi = max + pad;

            const pts = values.map((v, i) => {
                const x = PL + (i / (n - 1)) * (W - PL - PR);
                const y = PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
                return [x, y, v];
            });
            ptsCache = pts;

            $('linePath').setAttribute('d', smoothPath(pts));
            $('areaPath').setAttribute('d', smoothPath(pts) + ` L ${pts[n - 1][0].toFixed(1)} ${H - PB} L ${pts[0][0].toFixed(1)} ${H - PB} Z`);

            // grid + axis ticks
            let g = '';
            const ticks = 4;
            for (let t = 0; t <= ticks; t++) {
                const vv = lo + (hi - lo) * t / ticks;
                const y = PT + (1 - t / ticks) * (H - PT - PB);
                g += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="rgba(148,163,184,0.13)" stroke-width="1" stroke-dasharray="2 5"/>`;
                g += `<text x="${PL - 8}" y="${y + 4}" fill="rgba(148,163,184,0.75)" font-size="10" text-anchor="end" font-family="Inter,sans-serif">$${fmtCompact(vv)}</text>`;
            }
            [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1].forEach(i => {
                const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
                g += `<text x="${pts[i][0]}" y="${H - 6}" fill="rgba(148,163,184,0.6)" font-size="10" text-anchor="${anchor}" font-family="Inter,sans-serif">${labels[i]}</text>`;
            });
            $('grid').innerHTML = g;

            // header numbers
            const cur = values[n - 1], prev = values[0];
            const change = prev === 0 ? 0 : (cur - prev) / prev * 100;
            $('chartValue').textContent = '$' + fmt(cur);
            $('chartChange').className = 'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md border ' + (change >= 0 ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20' : 'bg-rose-500/15 text-rose-300 border-rose-500/20');
            $('chartChange').innerHTML = `<i class="fa-solid ${change >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i> ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
            $('chartSub').textContent = PERIOD_SUB[period] + ' · Updated just now';

            // period buttons active state
            document.querySelectorAll('[data-period]').forEach(b => {
                const active = b.dataset.period === period;
                b.className = 'px-2.5 py-1 rounded-lg transition ' + (active
                    ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-semibold shadow-accent'
                    : 'text-slate-400 hover:text-white');
            });

            // reset crosshair
            $('crosshairLine').style.opacity = 0;
            $('crosshairDot').style.opacity = 0;
            $('chartTip').style.opacity = 0;
        }

        /* ---------- Chart crosshair + tooltip ---------- */
        const wrap = $('chartWrap');
        const tip = $('chartTip');
        wrap.addEventListener('mousemove', e => {
            if (!ptsCache.length) return;
            const rect = wrap.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width * W;
            let best = 0, bestD = Infinity;
            ptsCache.forEach((p, i) => {
                const d = Math.abs(p[0] - x);
                if (d < bestD) { bestD = d; best = i; }
            });
            const p = ptsCache[best];
            const line = $('crosshairLine'), dot = $('crosshairDot');
            line.setAttribute('x1', p[0]); line.setAttribute('x2', p[0]);
            dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]);
            line.style.opacity = 1; dot.style.opacity = 1;
            tip.style.left = (e.clientX - rect.left + 16) + 'px';
            tip.style.top = (p[1] / H * rect.height) + 'px';
            tip.innerHTML = `<b>$${fmt(p[2])}</b><br><span>${PERIOD_LABELS[currentPeriod][best]}</span>`;
            tip.style.opacity = 1;
        });
        wrap.addEventListener('mouseleave', () => {
            $('crosshairLine').style.opacity = 0;
            $('crosshairDot').style.opacity = 0;
            tip.style.opacity = 0;
        });
