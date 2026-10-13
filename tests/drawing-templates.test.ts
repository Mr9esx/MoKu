import { describe, expect, it } from "vitest";
import { isValidDrawingRule, parseDrawingTemplates, captureDrawingTemplate } from "../src/core/drawingTemplates";
import type { DrawingDocument, DrawingShape } from "../src/core/drawingTypes";

const saved = (rules: unknown, name = "加工图") => JSON.stringify([{ name, rules }]);

describe("saved drawing mappings", () => {
  it("accepts the supported explicit roles and positive numeric metadata", () => {
    for (const role of ["unknown", "outer", "hole", "pocket", "stock", "ignore"]) {
      expect(isValidDrawingRule({ role })).toBe(true);
    }
    expect(isValidDrawingRule({ role: "pocket", depth: 0.001, thickness: 18 })).toBe(true);
  });
  it("restores explicit machining roles and positive millimetre depths", () => {
    const rules = { Router: { role: "pocket", depth: 2.75, thickness: 18 }, CUT: { role: "outer" }, Auxiliary: { role: "ignore" } };
    const templates = parseDrawingTemplates(saved(rules));
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ name: "加工图", rules });
    expect(parseDrawingTemplates(JSON.stringify(templates))).toEqual(templates);
  });

  it.each([null, "", "{bad", "null", "{}", "42", '"template"'])
    ("returns no mappings for malformed or non-list data %s", raw => {
      expect(parseDrawingTemplates(raw)).toEqual([]);
    });

  it.each(["routing", "OUTER", "", null, 1])("rejects an unrecognized role %s", role => {
    expect(parseDrawingTemplates(saved({ Router: { role } }))).toEqual([]);
  });

  it.each([0, -1, NaN, Infinity, -Infinity, "3", null])("rejects invalid numeric metadata %s", value => {
    for (const field of ["depth", "thickness"]) {
      const rule = { role: "pocket", [field]: value };
      expect(isValidDrawingRule(rule)).toBe(false);
      expect(parseDrawingTemplates(saved({ Router: rule }))).toEqual([]);
    }
  });

  it("rejects rules with unknown fields or inherited role semantics", () => {
    expect(isValidDrawingRule({ role: "outer", document: { shapes: [] } })).toBe(false);
    expect(isValidDrawingRule(Object.create({ role: "outer" }))).toBe(false);
    expect(parseDrawingTemplates(saved({ Router: { role: "outer", points: [] } }))).toEqual([]);
  });

  it.each([
    [{ name: "", rules: {} }], [{ name: " ", rules: {} }], [{ name: "x".repeat(81), rules: {} }],
    [{ rules: {} }], [{ name: "x", rules: [] }], [{ name: "x", rules: null }],
  ])("rejects malformed template records %#", templates => {
    expect(parseDrawingTemplates(JSON.stringify(templates))).toEqual([]);
  });

  it("does not discard a valid mapping beside an invalid saved record", () => {
    expect(parseDrawingTemplates('[null,{"name":"usable","rules":{"Router":{"role":"hole"}}}]'))
      .toMatchObject([{ name: "usable", rules: { Router: { role: "hole" } } }]);
  });

  it("rejects excessive payloads, template counts and layer entries", () => {
    expect(parseDrawingTemplates(saved({ Router: { role: "outer" } }) + " ".repeat(500_001))).toEqual([]);
    expect(parseDrawingTemplates(JSON.stringify(Array.from({ length: 101 }, (_, index) => ({ name: String(index), rules: {} }))))).toEqual([]);
    expect(parseDrawingTemplates(saved(Object.fromEntries(Array.from({ length: 2_001 }, (_, index) => [String(index), { role: "outer" }]))))).toEqual([]);
    expect(parseDrawingTemplates(saved({ ["x".repeat(1_001)]: { role: "outer" } }))).toEqual([]);
  });

  it("keeps prototype-shaped layer names as safe own data without inherited rules", () => {
    const templates = parseDrawingTemplates('[{"name":"safe","rules":{"__proto__":{"role":"pocket","depth":4},"constructor":{"role":"hole"},"toString":{"role":"ignore"}}}]');
    expect(templates).toHaveLength(1);
    const rules = templates[0].rules;
    expect(Object.getPrototypeOf(rules)).toBeNull();
    expect(Object.hasOwn(rules, "__proto__")).toBe(true);
    expect(rules.__proto__).toEqual({ role: "pocket", depth: 4 });
    expect(rules.constructor).toEqual({ role: "hole" });
    expect(rules.toString).toEqual({ role: "ignore" });
    expect(rules.hasOwnProperty).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("role");
  });

  it("sanitizes template objects to configuration fields only", () => {
    const templates = parseDrawingTemplates('[{"name":"safe","rules":{"Router":{"role":"outer"}},"document":{"shapes":[1]},"__proto__":{"polluted":true}}]');
    expect(templates).toHaveLength(1);
    expect(Object.keys(templates[0])).toEqual(["name", "rules"]);
    expect(Object.keys(templates[0].rules.Router)).toEqual(["role"]);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});

const figure = (id: string, layer: string, space = 'Model'): DrawingShape => ({id,layer,space,entityType:'CIRCLE',closed:true,valid:true,points:[{x:0,y:0}],sourceIds:[id]});
const drawing = (shapes: DrawingShape[]): DrawingDocument => ({name:'test',unitKnown:true,importInfo:{sourceUnit:'毫米',scale:1,overridden:false},spaces:['Model','Paper'],shapes,labels:[],diagnostics:[]});

it('saves actual uniform figure confirmations rather than their still-unknown layer defaults', () => {
  const d=drawing([figure('a','Router'),figure('b','Router'),figure('elsewhere','Router','Paper')]);
  const saved=captureDrawingTemplate(d,'Model',{Router:{role:'unknown'}},{a:{role:'pocket',depth:3,geometrySource:'original'},b:{role:'pocket',pocketGeometry:'area',depth:3},elsewhere:{role:'hole'}});
  expect(saved.rules).toEqual({Router:{role:'pocket',pocketGeometry:'area',depth:3}});
  expect(saved.skipped).toEqual([]);
  expect(parseDrawingTemplates(JSON.stringify([{name:'saved',rules:saved.rules}]))[0].rules.Router).toEqual({role:'pocket',pocketGeometry:'area',depth:3});
});

it('does not flatten mixed layers or save unconfirmed and incomplete machining rules', () => {
  const d=drawing([figure('a','mixed'),figure('b','mixed'),figure('c','unknown'),figure('d','missing-depth'),figure('e','missing-width'),figure('f','usable')]);
  const saved=captureDrawingTemplate(d,'Model',{}, {a:{role:'outer'},b:{role:'stock'},d:{role:'pocket'},e:{role:'pocket',pocketGeometry:'centerline',depth:3},f:{role:'hole',geometrySource:'original',depth:3}});
  expect(saved.rules).toEqual({usable:{role:'hole'}});
  expect(saved.skipped).toEqual([{layer:'mixed',reason:'同层设置不一致'},{layer:'unknown',reason:'用途未确认'},{layer:'missing-depth',reason:'槽参数未填完整'},{layer:'missing-width',reason:'槽参数未填完整'}]);
});
