/**
 * Annotation items live in image pixel space:
 * strokes {type:'stroke', points, color, width}, hollow shapes {type:'rect'|'ellipse', x1, y1, x2, y2, color, width}
 * and comments {type:'comment', x, y, width, text, fontSize, bold, italic}.
 */
export class Annotations {
  constructor() {
    this.items = [];
    this.redoStack = [];
  }

  get canUndo() {
    return this.items.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  add(item) {
    this.items.push(item);
    this.redoStack = [];
  }

  undo() {
    if (this.canUndo) this.redoStack.push(this.items.pop());
  }

  redo() {
    if (this.canRedo) this.items.push(this.redoStack.pop());
  }

  clear() {
    this.items = [];
    this.redoStack = [];
  }
}

function styleStroke(ctx, stroke) {
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** Draws one segment of a stroke while it is being drawn. A zero-length segment is a dot. */
export function drawSegment(ctx, stroke, from, to) {
  styleStroke(ctx, stroke);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function drawStroke(ctx, stroke) {
  styleStroke(ctx, stroke);
  const [first, ...rest] = stroke.points;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const point of rest) ctx.lineTo(point.x, point.y);
  ctx.lineTo(stroke.points.at(-1).x, stroke.points.at(-1).y);
  ctx.stroke();
}

function drawRect(ctx, shape) {
  styleStroke(ctx, shape);
  ctx.strokeRect(
    Math.min(shape.x1, shape.x2),
    Math.min(shape.y1, shape.y2),
    Math.abs(shape.x2 - shape.x1),
    Math.abs(shape.y2 - shape.y1),
  );
}

function drawEllipse(ctx, shape) {
  styleStroke(ctx, shape);
  ctx.beginPath();
  ctx.ellipse(
    (shape.x1 + shape.x2) / 2,
    (shape.y1 + shape.y2) / 2,
    Math.abs(shape.x2 - shape.x1) / 2,
    Math.abs(shape.y2 - shape.y1) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
}

/** Breaks text into lines of at most `maxWidth`: at newlines, then at spaces, then inside words that are too wide. */
export function wrapLines(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = '';
        for (const char of word) {
          if (line && measure(line + char) > maxWidth) {
            lines.push(line);
            line = char;
          } else {
            line += char;
          }
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawComment(ctx, comment) {
  const { x, y, text, fontSize, width } = comment;
  const padding = fontSize * 0.5;
  const lineHeight = fontSize * 1.3;
  ctx.font = `${comment.italic ? 'italic ' : ''}${comment.bold ? 'bold ' : ''}${fontSize}px sans-serif`;
  ctx.textBaseline = 'top';
  const lines = wrapLines(text, Math.max(1, width - padding * 2), (line) => ctx.measureText(line).width);
  const boxWidth = width;
  const boxHeight = lines.length * lineHeight + padding * 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1, fontSize / 16);
  ctx.strokeRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = '#000000';
  lines.forEach((line, index) => ctx.fillText(line, x + padding, y + padding + index * lineHeight));
}

const painters = { stroke: drawStroke, rect: drawRect, ellipse: drawEllipse, comment: drawComment };

export function drawAnnotations(ctx, items) {
  for (const item of items) painters[item.type](ctx, item);
}
