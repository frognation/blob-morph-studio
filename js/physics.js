// physics.js — Spring-mass soft body simulation engine
// Natural inspiration: cell membranes, soap bubbles, slime mold (Physarum polycephalum)
// Technique: Verlet integration + Hooke's law springs

class Particle {
    constructor(x, y) {
        this.x = x;  this.y = y;
        this.vx = 0; this.vy = 0;
        this.fx = 0; this.fy = 0;
        this.pinned = false;
        this.frozen = false;
        this.mass = 1.0;
    }
}

class BlobChain {
    constructor() {
        this.id = null;
        this.particles = [];
        this.restLengths = [];
        this.closed = true;
        this.color = '#60a5fa';
        this.lineWidth = 2;
        this.showFilled = true;
        this.showOutline = true;
        this.visible = true;
        this.selected = false;
        this.label = '';
    }

    addParticle(x, y) {
        this.particles.push(new Particle(x, y));
    }

    initRestLengths() {
        const pts = this.particles;
        const n = pts.length;
        this.restLengths = [];
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const dx = pts[i].x - pts[j].x;
            const dy = pts[i].y - pts[j].y;
            this.restLengths.push(Math.sqrt(dx * dx + dy * dy));
        }
    }

    isValid() { return this.particles.length >= 3; }

    getBounds() {
        if (!this.particles.length) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of this.particles) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    }

    getCentroid() {
        if (!this.particles.length) return { x: 0, y: 0 };
        let sx = 0, sy = 0;
        for (const p of this.particles) { sx += p.x; sy += p.y; }
        return { x: sx / this.particles.length, y: sy / this.particles.length };
    }

    // Find closest particle to a point, returns { particle, index, distSq }
    closestParticle(x, y, maxDist = Infinity) {
        let best = null, bestDist = maxDist * maxDist;
        this.particles.forEach((p, i) => {
            const d = (p.x - x) ** 2 + (p.y - y) ** 2;
            if (d < bestDist) { bestDist = d; best = { particle: p, index: i }; }
        });
        return best ? { ...best, distSq: bestDist } : null;
    }

    // Check if point is inside (for click selection)
    containsPoint(x, y) {
        const pts = this.particles;
        if (pts.length < 3) return false;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }
}

class PhysicsEngine {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.chains = [];
        this._nextId = 0;

        // Parameters (0–1 normalized internally)
        this.stiffness    = 0.3;
        this.damping      = 0.85;   // 1.0 = fully damped (frozen), 0.0 = no damping
        this.chaos        = 0.0;
        this.inflation    = 0.0;
        this.timeStep     = 1.0;    // speed multiplier
        this.repulsion    = 0.09;
        this.gravity      = false;
        this.gravityAcc   = 0.4;

        this._noiseTime = 0;
        this._paused = false;
    }

    get paused() { return this._paused; }
    togglePause() { this._paused = !this._paused; return this._paused; }

    addChain(chain) {
        chain.id = this._nextId++;
        if (!chain.label) chain.label = `Blob ${chain.id}`;
        chain.initRestLengths();
        this.chains.push(chain);
        return chain;
    }

    removeChain(id) {
        const idx = this.chains.findIndex(c => c.id === id);
        if (idx >= 0) this.chains.splice(idx, 1);
    }

    getChain(id) { return this.chains.find(c => c.id === id) || null; }

    clear() { this.chains = []; }

    // Main update step — called each animation frame
    update() {
        if (this._paused) return;
        const dt = this.timeStep * 0.55;
        this._noiseTime += dt * 0.012;

        for (const chain of this.chains) {
            if (chain.visible) this._updateChain(chain, dt);
        }

        // Inter-chain repulsion (O(n²) between all pairs of particles across chains)
        if (this.repulsion > 0 && this.chains.length > 1) {
            this._interChainRepulsion();
        }
    }

    _updateChain(chain, dt) {
        const pts = chain.particles;
        const n = pts.length;
        if (n < 2) return;

        // Reset forces
        for (const p of pts) { p.fx = 0; p.fy = 0; }

        // Spring forces (Hooke's law) between adjacent particles
        const loopCount = chain.closed ? n : n - 1;
        for (let i = 0; i < loopCount; i++) {
            const j = (i + 1) % n;
            const a = pts[i], b = pts[j];
            const rl = chain.restLengths[i];

            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1e-4;
            const stretch = dist - rl;
            const f = this.stiffness * stretch;
            const fx = (dx / dist) * f, fy = (dy / dist) * f;

            if (!a.pinned && !a.frozen) { a.fx += fx; a.fy += fy; }
            if (!b.pinned && !b.frozen) { b.fx -= fx; b.fy -= fy; }
        }

        // Inflation — outward radial pressure from centroid
        if (this.inflation !== 0) {
            const c = chain.getCentroid();
            for (const p of pts) {
                if (p.pinned || p.frozen) continue;
                const dx = p.x - c.x, dy = p.y - c.y;
                const d = Math.sqrt(dx * dx + dy * dy) || 1;
                p.fx += (dx / d) * this.inflation * 0.8;
                p.fy += (dy / d) * this.inflation * 0.8;
            }
        }

        // Gravity
        if (this.gravity) {
            for (const p of pts) {
                if (!p.pinned && !p.frozen) p.fy += this.gravityAcc;
            }
        }

        // Integrate: forces → velocity → position
        for (const p of pts) {
            if (p.pinned || p.frozen) continue;

            // Chaos: smooth noise perturbation (value noise)
            if (this.chaos > 0) {
                const nx = this._valueNoise(p.x * 0.008 + this._noiseTime * 1.3, p.y * 0.008 + this._noiseTime * 0.7) - 0.5;
                const ny = this._valueNoise(p.x * 0.008 + this._noiseTime * 0.5, p.y * 0.008 + this._noiseTime * 1.1) - 0.5;
                p.fx += nx * this.chaos * 3.5;
                p.fy += ny * this.chaos * 3.5;
            }

            p.vx = p.vx * this.damping + p.fx * dt;
            p.vy = p.vy * this.damping + p.fy * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            // Soft boundary walls
            const m = 8;
            if (p.x < m) { p.x = m; p.vx = Math.abs(p.vx) * 0.4; }
            if (p.y < m) { p.y = m; p.vy = Math.abs(p.vy) * 0.4; }
            if (p.x > this.width - m) { p.x = this.width - m; p.vx = -Math.abs(p.vx) * 0.4; }
            if (p.y > this.height - m) { p.y = this.height - m; p.vy = -Math.abs(p.vy) * 0.4; }
        }
    }

    _interChainRepulsion() {
        const minD = 18, minDSq = minD * minD;
        for (let ci = 0; ci < this.chains.length - 1; ci++) {
            for (let cj = ci + 1; cj < this.chains.length; cj++) {
                const A = this.chains[ci].particles;
                const B = this.chains[cj].particles;
                for (const a of A) {
                    for (const b of B) {
                        const dx = b.x - a.x, dy = b.y - a.y;
                        const dSq = dx * dx + dy * dy;
                        if (dSq < minDSq && dSq > 0) {
                            const d = Math.sqrt(dSq);
                            const f = this.repulsion * (minD - d) / d;
                            const fx = dx * f, fy = dy * f;
                            if (!a.pinned && !a.frozen) { a.vx -= fx * 0.08; a.vy -= fy * 0.08; }
                            if (!b.pinned && !b.frozen) { b.vx += fx * 0.08; b.vy += fy * 0.08; }
                        }
                    }
                }
            }
        }
    }

    // Smooth value noise (bilinear interpolation of random values)
    _valueNoise(x, y) {
        const ix = Math.floor(x), iy = Math.floor(y);
        const fx = x - ix, fy = y - iy;
        const smooth = t => t * t * (3 - 2 * t);
        const rand = (a, b) => {
            const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
            return n - Math.floor(n);
        };
        const sfx = smooth(fx), sfy = smooth(fy);
        return (rand(ix, iy) * (1 - sfx) + rand(ix + 1, iy) * sfx) * (1 - sfy)
             + (rand(ix, iy + 1) * (1 - sfx) + rand(ix + 1, iy + 1) * sfx) * sfy;
    }

    // Excitability maps to inverse damping: high excitability = low damping
    setExcitability(pct) {
        this.damping = 1.0 - pct * 0.18;  // 50% excitability → ~0.91 damping
    }

    setStiffness(pct) { this.stiffness = pct * 0.012; }
    setChaos(pct)     { this.chaos = pct * 0.014; }
    setInflation(pct) { this.inflation = pct * 0.018; }
    setSpeed(pct)     { this.timeStep = 0.1 + pct * 1.9; }

    resize(w, h) { this.width = w; this.height = h; }
}
