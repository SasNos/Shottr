/** Annotation items live in image pixel space: strokes {type:'stroke'} and comments {type:'comment'}. */
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

function drawComment(ctx, comment) {
  const { x, y, text, fontSize } = comment;
  const lines = text.split('\n');
  const padding = fontSize * 0.5;
  const lineHeight = fontSize * 1.3;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = 'top';
  const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const boxWidth = textWidth + padding * 2;
  const boxHeight = lines.length * lineHeight + padding * 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1, fontSize / 16);
  ctx.strokeRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = '#000000';
  lines.forEach((line, index) => ctx.fillText(line, x + padding, y + padding + index * lineHeight));
}

const painters = { stroke: drawStroke, comment: drawComment };

export function drawAnnotations(ctx, items) {
  for (const item of items) painters[item.type](ctx, item);
}
