import assert from "node:assert/strict";
import test from "node:test";
import {
  CIRCLE,
  SketchError,
  addLink,
  addScreen,
  boxOf,
  dragHandle,
  ellipseNode,
  findNode,
  findScreen,
  freeSpot,
  idsOf,
  imageNode,
  lineNode,
  mirrorPath,
  newId,
  newSketch,
  penNode,
  placeNode,
  placeScreen,
  rectangleNode,
  removeLink,
  removeNode,
  removeScreen,
  renderScreen,
  simplify,
  textBox,
  textNode,
  validateSketch,
} from "../features/blueprint/review/sketch-format.mjs";

const STYLE = { stroke: "#1c1c1c", fill: "none" };
const UUID = "0b9d6a54-2b6f-4d8f-9a53-5f1d2f7b8c11";

/** A sketch with every kind of node and one arrow, built the way the page builds one. */
function sample() {
  const sketch = newSketch("checkout", "Checkout");
  const coupon = addScreen(sketch, { title: "Coupon", x: 0, y: 1000 });
  const receipt = addScreen(sketch, { title: "Receipt", x: 1800, y: 1000, w: 390, h: 844 });
  coupon.root.kids.push(
    rectangleNode(sketch, { x: 40, y: 40, w: 300, h: 80 }, STYLE),
    ellipseNode(sketch, { x: 400, y: 40, w: 120, h: 80 }, { stroke: "#d93636", fill: "#fde68a" }),
    lineNode(sketch, { x: 40, y: 300 }, { x: 340, y: 200 }, STYLE),
    penNode(sketch, [{ x: 10, y: 10 }, { x: 40, y: 80 }, { x: 90, y: 30 }, { x: 140, y: 120 }], STYLE),
    textNode(sketch, { x: 40, y: 400 }, "Enter a coupon\nor skip", STYLE),
    imageNode(sketch, { x: 600, y: 300, w: 200, h: 120 }, `assets/${UUID}.png`),
  );
  addLink(sketch, coupon.id, receipt.id);
  return sketch;
}

const refused = (mutate, pattern, base = sample()) => {
  mutate(base);
  assert.throws(() => validateSketch(base), (error) => error instanceof SketchError && pattern.test(error.message), String(pattern));
};

test("a sketch the page builds is accepted, and what comes back is a copy", () => {
  const sketch = sample();
  const checked = validateSketch(sketch);
  assert.deepEqual(checked, sketch);
  assert.notEqual(checked, sketch);
  assert.notEqual(checked.screens[0], sketch.screens[0]);
  assert.deepEqual(validateSketch(JSON.parse(JSON.stringify(sketch))), sketch);
  assert.deepEqual(validateSketch(newSketch("checkout", "Checkout")).screens, []);
});

test("every node kind is Blueprint JSON v1: boxes, vectors of kind circle, line and pen, text and images", () => {
  const [coupon] = sample().screens;
  const [rectangle, ellipse, line, pen, text, image] = coupon.root.kids;
  assert.deepEqual([rectangle.t, rectangle.dir, rectangle.kind, rectangle.kids], ["box", "stack", "rectangle", []]);
  assert.deepEqual([ellipse.t, ellipse.kind, ellipse.d], ["vector", "circle", CIRCLE]);
  assert.deepEqual([line.t, line.kind, line.d], ["vector", "line", "M0 100 L100 0"]);
  assert.deepEqual([pen.t, pen.kind, pen.fill], ["vector", "pen", "none"]);
  assert.match(pen.d, /^M[\d. ]+( L[\d. ]+)+$/);
  assert.deepEqual([text.t, text.value, text.size], ["text", "Enter a coupon\nor skip", 24]);
  assert.deepEqual([image.t, image.src], ["image", `assets/${UUID}.png`]);
  for (const node of coupon.root.kids) {
    assert.ok(node.w >= 1 && node.h >= 1);
    assert.match(node.id, /^n-[a-z0-9]+-[a-f0-9]{6}$/);
  }
  assert.equal(coupon.root.w, coupon.w);
  assert.equal(coupon.pageId, "sketch");
});

test("a screen of a sketch that follows v1 is refused when it does not, naming the field", () => {
  refused((s) => (s.formatVersion = 2), /^formatVersion must be 1/);
  refused((s) => (s.script = "x"), /^script is not part of a Lite sketch/);
  refused((s) => delete s.links, /^links is missing/);
  refused((s) => s.threads.push({}), /^threads must be an empty list/);
  refused((s) => s.components.push({}), /^components must be an empty list/);
  refused((s) => s.fonts.push({}), /^fonts must be an empty list/);
  refused((s) => (s.title = ""), /^title must be 1 to 200/);
  refused((s) => (s.pages = []), /^pages must be a list of 1 to 100/);
  refused((s) => s.pages[0].objects.push({}), /^pages\[0\]\.objects must be an empty list/);
  refused((s) => s.pages[0].order.push("nowhere"), /^pages\[0\]\.order names a screen/);
  refused((s) => (s.pages[0].start = "nowhere"), /^pages\[0\]\.start names a screen/);
  refused((s) => (s.screens[0].pageId = "other"), /^screens\[0\]\.pageId must name a page/);
  refused((s) => (s.screens[0].w = 0), /^screens\[0\]\.w and h must be numbers from 1 to 16000/);
  refused((s) => (s.screens[0].x = Number.NaN), /^screens\[0\]\.x and y/);
  refused((s) => (s.screens[0].build = { url: "https://x.example" }), /^screens\[0\]\.build is not part of a Lite sketch/);
  refused((s) => (s.screens[0].root.w = 10), /^screens\[0\]\.root must be as wide and tall as its screen/);
  refused((s) => (s.screens[0].root.place = { x: 5, y: 0 }), /^screens\[0\]\.root\.place must be/);
  refused((s) => (s.screens[0].root.t = "text"), /^screens\[0\]\.root\.dir belongs to a box/);
});

test("a node is refused for the field that is wrong", () => {
  const kid = (s, index = 0) => s.screens[0].root.kids[index];
  refused((s) => (kid(s).fill = "red"), /kids\[0\]\.fill must be #rrggbb/);
  refused((s) => (kid(s).stroke = "#12345"), /kids\[0\]\.stroke must be/);
  refused((s) => (kid(s).strokeWidth = 101), /kids\[0\]\.strokeWidth/);
  refused((s) => (kid(s).kind = "star"), /kids\[0\]\.kind must be one of/);
  refused((s) => (kid(s).w = 16001), /kids\[0\]\.w must be a number from 1 to 16000/);
  refused((s) => (kid(s).place = { x: 1e6, y: 0 }), /kids\[0\]\.place/);
  refused((s) => (kid(s).name = ""), /kids\[0\]\.name must be 1 to 200/);
  refused((s) => (kid(s).opacity = 2), /kids\[0\]\.opacity/);
  refused((s) => delete kid(s).kids, /kids\[0\]\.kids must be a list on a box/);
  refused((s) => (kid(s).dir = "row"), /kids\[0\]\.dir must be "stack"/);
  refused((s) => (kid(s, 1).d = 'M0 0" onload="x'), /kids\[1\]\.d must be an SVG path/);
  refused((s) => delete kid(s, 1).d, /kids\[1\]\.d is required on a vector/);
  refused((s) => (kid(s, 4).value = 5), /kids\[4\]\.value/);
  refused((s) => delete kid(s, 4).value, /kids\[4\]\.value is required on text/);
  refused((s) => (kid(s, 4).font = "A<b>"), /kids\[4\]\.font must be a font family name/);
  refused((s) => (kid(s, 4).states = { hover: {} }), /kids\[4\]\.states is not part of a Lite sketch/);
  refused((s) => (kid(s, 4).runs = []), /kids\[4\]\.runs is not part of a Lite sketch/);
  refused((s) => (kid(s, 5).src = "https://evil.example/a.png"), /kids\[5\]\.src must be assets\/<uuid>/);
  refused((s) => (kid(s, 5).src = "assets/../../x.png"), /kids\[5\]\.src must be assets\/<uuid>/);
  refused((s) => (kid(s, 5).src = `assets/${UUID}.svg`), /kids\[5\]\.src must be assets\/<uuid>/);
  refused((s) => delete kid(s, 5).src, /kids\[5\]\.src is required on an image/);
});

test("ids are lowercase, and none is used twice across pages, screens, nodes and links", () => {
  refused((s) => (s.screens[0].id = "Coupon"), /^screens\[0\]\.id must be lowercase/);
  refused((s) => (s.screens[0].root.kids[0].id = s.screens[0].id), /kids\[0\]\.id is used twice/);
  refused((s) => (s.screens[1].id = s.screens[0].id), /^screens\[1\]\.id is used twice/);
  refused((s) => (s.links[0].id = s.pages[0].id), /^links\[0\]\.id is used twice/);
  refused((s) => (s.screens[0].root.kids[0].id = "n".repeat(81)), /kids\[0\]\.id must be lowercase letters and digits joined by hyphens, at most 80/);
  const sketch = sample();
  const ids = idsOf(sketch);
  assert.equal(ids.size, 1 + 2 + 2 + 6 + 1, "a page, two screens with their roots, six nodes and a link");
  assert.match(newId("s"), /^s-[a-z0-9]+-[a-f0-9]{6}$/);
});

test("the limits of v1 hold: nodes, depth, links and the shape of a link", () => {
  const sketch = sample();
  const many = [];
  for (let i = 0; i < 10001; i += 1) many.push({ id: `m-${i}`, name: "Box", t: "box", dir: "stack", place: { x: 0, y: 0 }, w: 1, h: 1, kids: [] });
  sketch.screens[0].root.kids = many.slice(0, 2000);
  sketch.screens[1].root.kids = many.slice(2000, 4000).map((node, i) => ({ ...node, id: `n-${i}` }));
  assert.doesNotThrow(() => validateSketch(sketch));
  const crowded = sample();
  crowded.screens[0].root.kids = new Array(2001).fill(0).map((_, i) => ({ ...many[0], id: `c-${i}` }));
  assert.throws(() => validateSketch(crowded), /kids must be a list of at most 2000/);

  const deep = sample();
  let at = deep.screens[0].root;
  for (let i = 0; i < 30; i += 1) {
    const next = { id: `d-${i}`, name: "Deep", t: "box", dir: "stack", place: { x: 0, y: 0 }, w: 10, h: 10, kids: [] };
    at.kids.push(next);
    at = next;
  }
  assert.throws(() => validateSketch(deep), /nested deeper than 30 levels/);

  refused((s) => (s.links[0].to = s.links[0].from), /^links\[0\] must join two different screens/);
  refused((s) => (s.links[0].transition = "wipe"), /^links\[0\]\.transition must be cut, fade or slide/);
  refused((s) => (s.links[0].label = "Continue"), /^links\[0\]\.label is not part of a Lite sketch/);
  refused((s) => (s.links[0].duration = 3000), /^links\[0\]\.duration/);
  refused((s) => (s.links[0].element = "nowhere"), /^links\[0\]\.element must name a node of the sketch screen the link leaves/);
});

test("the one extension: an arrow may join screens of the board module, whose ids the sketch does not hold", () => {
  const sketch = sample();
  const [coupon] = sketch.screens;
  assert.ok(addLink(sketch, "pay", coupon.id), "from a screen of the board to a sketch screen");
  assert.ok(addLink(sketch, coupon.id, "cart"), "and the other way");
  assert.deepEqual(validateSketch(sketch).links.map((link) => [link.from, link.to]), [[coupon.id, sketch.screens[1].id], ["pay", coupon.id], [coupon.id, "cart"]]);
  // v1 keeps links inside one page and one file, so a consumer of plain v1 drops these two; the end of an arrow is still a plain id.
  refused((s) => (s.links[0].from = "Cart Page"), /^links\[0\]\.from must be a screen id/, sketch);
  // An element can only start an arrow from a screen of the sketch.
  const element = sample();
  element.links[0].element = element.screens[0].root.kids[0].id;
  assert.doesNotThrow(() => validateSketch(element));
  element.links[0].from = "pay";
  assert.throws(() => validateSketch(element), /element must name a node of the sketch screen/);
});

test("building a sketch keeps screens, their page order and their arrows consistent", () => {
  const sketch = sample();
  const [coupon, receipt] = sketch.screens;
  assert.deepEqual(sketch.pages[0].order, [coupon.id, receipt.id]);
  assert.equal(findScreen(sketch, receipt.id), receipt);
  assert.equal(findNode(coupon, coupon.root.kids[2].id), coupon.root.kids[2]);
  assert.equal(findNode(coupon, "missing"), null);

  assert.equal(addLink(sketch, coupon.id, receipt.id), null, "the same pair is one arrow");
  assert.equal(addLink(sketch, coupon.id, coupon.id), null, "a screen is not joined to itself");
  assert.ok(addLink(sketch, receipt.id, coupon.id), "the way back is another arrow");
  assert.equal(sketch.links.length, 2);
  assert.equal(removeLink(sketch, sketch.links[1].id), true);
  assert.equal(removeLink(sketch, "nowhere"), false);

  sketch.links[0].element = coupon.root.kids[0].id;
  assert.equal(removeNode(sketch, coupon, coupon.root.kids[0].id), true);
  assert.equal(sketch.links.length, 0, "an arrow that left a shape goes with it");
  assert.equal(removeNode(sketch, coupon, "missing"), false);

  addLink(sketch, coupon.id, receipt.id);
  addLink(sketch, "pay", coupon.id);
  removeScreen(sketch, coupon.id);
  assert.deepEqual(sketch.screens.map((screen) => screen.id), [receipt.id]);
  assert.deepEqual(sketch.pages[0].order, [receipt.id]);
  assert.deepEqual(sketch.links, []);
  assert.doesNotThrow(() => validateSketch(sketch));
});

test("a stroke is simplified to the points that matter, and a dot is not a stroke", () => {
  const sketch = newSketch("checkout", "Checkout");
  const straight = Array.from({ length: 200 }, (_, i) => ({ x: i, y: i / 2 }));
  assert.deepEqual(simplify(straight), [straight[0], straight.at(-1)]);
  const corner = [...Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 })), ...Array.from({ length: 50 }, (_, i) => ({ x: 50, y: i }))];
  assert.deepEqual(simplify(corner), [corner[0], { x: 49, y: 0 }, { x: 50, y: 1 }, corner.at(-1)].length === 4 ? simplify(corner) : []);
  assert.ok(simplify(corner).length >= 3 && simplify(corner).length <= 4);

  assert.equal(penNode(sketch, [{ x: 5, y: 5 }], STYLE), null);
  assert.equal(penNode(sketch, [{ x: 5, y: 5 }, { x: 5.4, y: 5.2 }], STYLE), null);
  const wide = penNode(sketch, [{ x: 10, y: 20 }, { x: 110, y: 20 }], STYLE);
  assert.equal(wide.h, 1, "a flat stroke still has a box of at least one");
  assert.equal(wide.d, "M0 50 L100 50");
  const long = penNode(sketch, Array.from({ length: 5000 }, (_, i) => ({ x: i, y: Math.round(Math.sin(i / 40) * 50) })), STYLE);
  assert.ok(long.d.length < 40000);
  const screen = addScreen(sketch, { title: "Long", x: 0, y: 0 });
  screen.root.kids.push(long);
  assert.doesNotThrow(() => validateSketch(sketch));
});

test("a line that rises is a mirrored path, and a handle dragged over the far side flips the shape", () => {
  const sketch = newSketch("checkout", "Checkout");
  assert.equal(lineNode(sketch, { x: 0, y: 0 }, { x: 100, y: 50 }, STYLE).d, "M0 0 L100 100");
  assert.equal(lineNode(sketch, { x: 100, y: 50 }, { x: 0, y: 0 }, STYLE).d, "M100 100 L0 0");
  assert.equal(lineNode(sketch, { x: 0, y: 50 }, { x: 100, y: 0 }, STYLE).d, "M0 100 L100 0");
  const level = lineNode(sketch, { x: 0, y: 20 }, { x: 80, y: 20 }, STYLE);
  assert.deepEqual([level.h, level.d], [1, "M0 50 L100 50"]);

  const box = { x: 100, y: 100, w: 200, h: 100 };
  assert.deepEqual(dragHandle(box, "se", 50, 20), { x: 100, y: 100, w: 250, h: 120, flipX: false, flipY: false });
  assert.deepEqual(dragHandle(box, "nw", 30, 10), { x: 130, y: 110, w: 170, h: 90, flipX: false, flipY: false });
  assert.deepEqual(dragHandle(box, "e", -250, 99), { x: 50, y: 100, w: 50, h: 100, flipX: true, flipY: false });
  assert.deepEqual(dragHandle(box, "s", 0, -150), { x: 100, y: 50, w: 200, h: 50, flipX: false, flipY: true });
  assert.equal(dragHandle(box, "e", -200, 0).w, 1, "a box never collapses to nothing");
  assert.equal(dragHandle(box, "e", -200, 0, 8).w, 8);

  assert.equal(mirrorPath("M0 100 L100 0", true, false), "M100 100 L0 0");
  assert.equal(mirrorPath("M0 100 L100 0", false, true), "M0 0 L100 100");
  assert.equal(mirrorPath("M12.5 80 L40 20", true, true), "M87.5 20 L60 80");
  assert.equal(mirrorPath("M0 0 C10 10 20 20 30 30", true, false), "M0 0 C10 10 20 20 30 30", "a path with curves is left as it is");

  const rising = lineNode(sketch, { x: 0, y: 50 }, { x: 100, y: 0 }, STYLE);
  placeNode(rising, { x: 10.4, y: 20.6, w: 150.2, h: 40, flipX: true, flipY: false });
  assert.deepEqual([rising.place, rising.w, rising.h, rising.d], [{ x: 10, y: 21 }, 150, 40, "M100 100 L0 0"]);
  const ellipse = ellipseNode(sketch, { x: 0, y: 0, w: 10, h: 10 }, STYLE);
  placeNode(ellipse, { x: 0, y: 0, w: 30, h: 20, flipX: true, flipY: true });
  assert.equal(ellipse.d, CIRCLE, "a circle is the same flipped");
  assert.deepEqual(boxOf(ellipse), { x: 0, y: 0, w: 30, h: 20 });

  const screen = addScreen(sketch, { title: "S", x: 0, y: 0 });
  placeScreen(screen, { x: 5.6, y: 6.4, w: 500.4, h: 300 });
  assert.deepEqual([screen.x, screen.y, screen.w, screen.h, screen.root.w, screen.root.h], [6, 6, 500, 300, 500, 300]);
  assert.doesNotThrow(() => validateSketch(sketch));
});

test("the next screen goes under the board at first and then beside the last one", () => {
  const sketch = newSketch("checkout", "Checkout");
  const board = [{ x: 0, y: 0, w: 1440, h: 900 }, { x: 1800, y: 0, w: 1440, h: 900 }];
  assert.deepEqual(freeSpot(sketch, []), { x: 0, y: 0 });
  assert.deepEqual(freeSpot(sketch, board), { x: 0, y: 1320 });
  const first = addScreen(sketch, { title: "A", x: 0, y: 1320 });
  assert.deepEqual(freeSpot(sketch, board), { x: first.x + first.w + 360, y: 1320 });
});

test("text takes the box its lines need, with the page's own measure when it has one", () => {
  assert.deepEqual(textBox("ab", 20), { w: Math.ceil(2 * 20 * 0.56 + 2), h: 26 });
  assert.deepEqual(textBox("a\nlonger line\nc", 10), { w: Math.ceil(11 * 10 * 0.56 + 2), h: 39 });
  assert.deepEqual(textBox("abc", 10, () => 50), { w: 52, h: 13 });
  assert.equal(textBox("", 10).w, 2);
});

test("a screen is drawn as svg whose shapes can be found by id, with the text and the names escaped", () => {
  const sketch = sample();
  const [coupon] = sketch.screens;
  const hostile = textNode(sketch, { x: 5, y: 5 }, '<script>alert("x")</script> & more', STYLE);
  hostile.name = 'Name "with" <quotes>';
  coupon.root.kids.push(hostile);
  const { svg, rects } = renderScreen(coupon, { assets: "/p/shop/assets" });
  assert.match(svg, /^<rect width="1440" height="900" fill="#ffffff"\/>/);
  for (const node of coupon.root.kids) {
    assert.ok(svg.includes(`data-name="${node.id}"`), node.name);
    assert.deepEqual(rects.get(node.id), { x: node.place.x, y: node.place.y, w: node.w, h: node.h });
  }
  assert.ok(!svg.includes("<script"), "text is never markup");
  assert.ok(svg.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more"));
  assert.ok(svg.includes('data-label="Name &quot;with&quot; &lt;quotes&gt;"'));
  assert.ok(svg.includes(`<image href="/p/shop/assets/${UUID}.png"`));
  assert.ok(svg.includes("<ellipse"), "a circle path is an ellipse, so its stroke is not stretched");
  assert.ok(svg.includes('d="M0 100 L300 0"'), "the rising line is scaled to its box");
  assert.ok(svg.includes('class="sk-grab"'), "outlines and lines carry a wider invisible stroke to be picked by");
  assert.ok(svg.includes('<tspan x="'), "text is drawn line by line");
  assert.equal((svg.match(/<tspan/g) ?? []).length, 3, "two lines of one text and one line of the other");
  assert.ok(!/\son\w+=/.test(svg), "no handler attribute is ever written");
});

test("nested boxes are drawn where they sit, with their own boxes, and a clipping box clips", () => {
  const sketch = newSketch("checkout", "Checkout");
  const screen = addScreen(sketch, { title: "Nest", x: 0, y: 0 });
  const outer = rectangleNode(sketch, { x: 100, y: 100, w: 400, h: 300 }, STYLE);
  outer.clip = true;
  const inner = rectangleNode(sketch, { x: 20, y: 30, w: 100, h: 50 }, STYLE);
  outer.kids.push(inner);
  screen.root.kids.push(outer);
  assert.doesNotThrow(() => validateSketch(sketch));
  const { svg, rects } = renderScreen(screen, { prefix: "rv" });
  assert.deepEqual(rects.get(inner.id), { x: 120, y: 130, w: 100, h: 50 }, "a box inside a box is measured from the screen");
  assert.ok(svg.includes(`<clipPath id="rv-${screen.id}-clip-${outer.id}">`));
  assert.ok(svg.includes(`clip-path="url(#rv-${screen.id}-clip-${outer.id})"`));
});

test("a path with curves is drawn stretched whole, with its stroke evened out, and an icon is a placeholder", () => {
  const sketch = newSketch("checkout", "Checkout");
  const screen = addScreen(sketch, { title: "Curves", x: 0, y: 0 });
  screen.root.kids.push({ id: "n-curve", name: "Curve", t: "vector", kind: "polygon", place: { x: 0, y: 0 }, w: 200, h: 100, d: "M0 0 C50 0 100 50 100 100", stroke: "#1c1c1c", strokeWidth: 4 });
  screen.root.kids.push({ id: "n-icon", name: "Icon", t: "icon", icon: "star", place: { x: 300, y: 0 }, w: 24, h: 24 });
  assert.doesNotThrow(() => validateSketch(sketch));
  const { svg } = renderScreen(screen);
  assert.ok(svg.includes('d="M0 0 C50 0 100 50 100 100" transform="translate(0 0) scale(2 1)"'));
  assert.match(svg, /stroke-width="2\.83"/);
  assert.ok(svg.includes('stroke-dasharray="4 3"'));
});
