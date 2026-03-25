// spline.js — Catmull-Rom spline rendering utilities
// Used to draw smooth organic curves through particle positions

/**
 * Evaluate a Catmull-Rom spline at parameter t (0..1) between p1 and p2,
 * with p0 and p3 as the surrounding control points.
 */
function catmullRomPoint(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return {
        x: 0.5 * ((2 * p1.x)
            + (-p0.x + p2.x) * t
            + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
            + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y)
            + (-p0.y + p2.y) * t
            + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
            + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
    };
}

/**
 * Build a flattened array of {x,y} spline points.
 * @param {Array<{x,y}>} pts  — control points (particle positions)
 * @param {boolean} closed    — whether to form a closed loop
 * @param {number}  segments  — subdivisions per segment
 */
function buildSplinePath(pts, closed = true, segments = 12) {
    const n = pts.length;
    if (n < 2) return [];
    if (n === 2) return [{ x: pts[0].x, y: pts[0].y }, { x: pts[1].x, y: pts[1].y }];

    const path = [];
    const loopCount = closed ? n : n - 1;

    for (let i = 0; i < loopCount; i++) {
        const p0 = pts[(i - 1 + n) % n];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        const p3 = pts[(i + 2) % n];

        for (let s = 0; s < segments; s++) {
            path.push(catmullRomPoint(p0, p1, p2, p3, s / segments));
        }
    }
    if (closed && path.length > 0) path.push({ ...path[0] });
    return path;
}

/**
 * Draw a Catmull-Rom spline path onto a 2D canvas context.
 * This is the core rendering routine for blobs.
 */
function drawSpline(ctx, pts, closed, color, lineWidth, fillColor, showFill, showOutline) {
    if (!pts || pts.length < 3) return;
    const path = buildSplinePath(pts, closed, 14);
    if (path.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    if (closed) ctx.closePath();

    if (showFill && fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fill();
    }
    if (showOutline) {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
    }
}

/**
 * Generate an SVG path string from particle positions using cubic Bézier approximation
 * of the Catmull-Rom spline (suitable for SVG export).
 */
function splineToSVGPath(pts, closed = true) {
    const n = pts.length;
    if (n < 2) return '';
    const path = buildSplinePath(pts, closed, 10);
    if (!path.length) return '';

    let d = `M ${path[0].x.toFixed(2)} ${path[0].y.toFixed(2)}`;
    for (let i = 1; i < path.length; i++) {
        d += ` L ${path[i].x.toFixed(2)} ${path[i].y.toFixed(2)}`;
    }
    if (closed) d += ' Z';
    return d;
}

/**
 * Douglas-Peucker polyline simplification.
 * Used to reduce the number of particles in text/image outlines.
 */
function simplifyPath(pts, epsilon = 2.0) {
    if (pts.length <= 2) return pts;

    function perpendicularDist(pt, lineA, lineB) {
        const dx = lineB.x - lineA.x, dy = lineB.y - lineA.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(pt.x - lineA.x, pt.y - lineA.y);
        const t = ((pt.x - lineA.x) * dx + (pt.y - lineA.y) * dy) / lenSq;
        const nx = lineA.x + t * dx, ny = lineA.y + t * dy;
        return Math.hypot(pt.x - nx, pt.y - ny);
    }

    function recurse(start, end) {
        let maxDist = 0, maxIdx = -1;
        for (let i = start + 1; i < end; i++) {
            const d = perpendicularDist(pts[i], pts[start], pts[end]);
            if (d > maxDist) { maxDist = d; maxIdx = i; }
        }
        if (maxDist > epsilon && maxIdx >= 0) {
            return [...recurse(start, maxIdx), ...recurse(maxIdx, end).slice(1)];
        }
        return [pts[start], pts[end]];
    }

    return recurse(0, pts.length - 1);
}

/**
 * Downsample a path to approximately targetCount points,
 * evenly spaced by index.
 */
function downsamplePath(pts, targetCount) {
    if (pts.length <= targetCount) return [...pts];
    const result = [];
    for (let i = 0; i < targetCount; i++) {
        result.push(pts[Math.round(i * (pts.length - 1) / (targetCount - 1))]);
    }
    return result;
}

/**
 * Convert hex color to rgba string with given alpha.
 */
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}
