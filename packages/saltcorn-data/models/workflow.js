/**
 * view description
 * @category saltcorn-data
 * @module models/workflow
 * @subcategory models
 */
const db = require("../db");
const { getState } = require("../db/state");
const Field = require("./field");
const { contract, is } = require("contractis");
const { applyAsync, apply } = require("../utils");

/**
 * Workflow class
 * @category saltcorn-data
 */
class Workflow {
  /**
   * Workflow constructor
   * @param {*} o 
   */
  constructor(o) {
    this.steps = o.steps || [];
    this.onDone = o.onDone || ((c) => c);
    this.action = o.action;
    this.__ = (s) => s;
    contract.class(this);
  }

  /**
   * @param {object} body 
   * @param {object} req 
   * @returns {Promise<object>}
   */
  async run(body, req) {
    if (req) this.__ = (s) => req.__(s);
    if (!body || !body.stepName) {
      return this.runStep(body || {}, 0);
    }
    const { stepName, contextEnc, ...stepBody } = body;

    const context = JSON.parse(decodeURIComponent(contextEnc));
    const stepIx = this.steps.findIndex((step) => step.name === stepName);
    if (stepIx === -1) {
      //error
    }
    const step = this.steps[stepIx];
    if (step.form) {
      const form = await applyAsync(step.form, context);

      const valres = form.validate(stepBody);
      if (valres.errors) {
        form.hidden("stepName", "contextEnc");
        form.values.stepName = step.name;
        form.values.contextEnc = contextEnc;

        if (this.action) form.action = this.action;
        if (!form.submitLabel)
          form.submitLabel =
            stepIx === this.steps.length - 1
              ? this.__("Save")
              : this.__("Next") + " &raquo;";

        return {
          renderForm: form,
          context,
          stepName: step.name,
          currentStep: stepIx + 1,
          maxSteps: this.steps.length,
          title: this.title(step, stepIx),
        };
      }
      const toCtx = step.contextField
        ? {
            [step.contextField]: {
              ...(context[step.contextField] || {}),
              ...valres.success,
            },
          }
        : valres.success;

      return this.runStep({ ...context, ...toCtx }, stepIx + 1);
    } else if (step.builder) {
      const toCtx0 = {
        columns: JSON.parse(decodeURIComponent(body.columns)),
        layout: JSON.parse(decodeURIComponent(body.layout)),
        //craft_nodes: JSON.parse(decodeURIComponent(body.craft_nodes))
      };
      const toCtx = step.contextField
        ? {
            [step.contextField]: {
              ...(context[step.contextField] || {}),
              ...toCtx0,
            },
          }
        : toCtx0;
      return this.runStep({ ...context, ...toCtx }, stepIx + 1);
    }
  }
  
  /**
   * @param {object} context 
   * @param {number} stepIx 
   * @returns {Promise<object>}
   */
  async runStep(context, stepIx) {
    if (stepIx >= this.steps.length) {
      return await this.onDone(context);
    }
    const step = this.steps[stepIx];
    if (step.onlyWhen) {
      const toRun = await applyAsync(step.onlyWhen, context);

      if (!toRun) return this.runStep(context, stepIx + 1);
    }
    if (step.form) {
      const form = await applyAsync(step.form, context);

      form.hidden("stepName", "contextEnc");
      form.values.stepName = step.name;
      form.values.contextEnc = encodeURIComponent(JSON.stringify(context));

      form.fields.forEach((fld) => {
        const ctxValue =
          step.contextField && fld.parent_field
            ? ((context[step.contextField] || {})[fld.parent_field] || {})[
                fld.name
              ]
            : step.contextField
            ? (context[step.contextField] || {})[fld.name]
            : context[fld.name];
        if (
          typeof ctxValue !== "undefined" &&
          typeof form.values[fld.name] === "undefined"
        ) {
          const value =
            fld.type && fld.type.read ? fld.type.read(ctxValue) : ctxValue;
          if (fld.parent_field) {
            form.values[`${fld.parent_field}_${fld.name}`] = value;
          } else form.values[fld.name] = value;
        }
      });
      if (this.action) form.action = this.action;
      if (!form.submitLabel)
        form.submitLabel =
          stepIx === this.steps.length - 1
            ? this.__("Save")
            : this.__("Next") + " &raquo;";
      return {
        renderForm: form,
        context,
        stepName: step.name,
        currentStep: stepIx + 1,
        maxSteps: this.steps.length,
        title: this.title(step, stepIx),
      };
    } else if (step.builder) {
      const options = await applyAsync(step.builder, context);
      return {
        renderBuilder: {
          options,
          context,
          layout: context.layout,
          action: this.action,
          stepName: step.name,
          mode: options.mode,
          version_tag: db.connectObj.version_tag,
        },
        context,
        stepName: step.name,
        currentStep: stepIx + 1,
        maxSteps: this.steps.length,
        title: this.title(step, stepIx),
      };
    }
  }

  /**
   * @param {object} step 
   * @param {number} stepIx 
   * @returns {string}
   */
  title(step, stepIx) {
    return `${step.name} (${this.__("step")} ${stepIx + 1} / ${
      this.steps.length > stepIx + 1 ? this.__("max") + " " : ""
    }${this.steps.length})`;
  }
}

Workflow.contract = {
  variables: {
    steps: is.array(is.obj({ name: is.str })),
    onDone: is.fun(is.obj(), is.obj()),
    action: is.maybe(is.str),
  },
  methods: {
    run: is.fun(
      is.obj(),
      is.promise(is.obj({ renderForm: is.maybe(is.class("Form")) }))
    ),
    runStep: is.fun([is.obj(), is.posint], is.promise(is.obj())),
  },
};

module.exports = Workflow;
