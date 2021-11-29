/**
 * @category server
 * @module routes/files
 * @subcategory routes
 */

const Router = require("express-promise-router");
const File = require("@saltcorn/data/models/file");
const User = require("@saltcorn/data/models/user");
const { getState } = require("@saltcorn/data/db/state");
const s3storage = require("../s3storage");


const {
  mkTable,
  renderForm,
  link,
  post_btn,
  post_delete_btn,
} = require("@saltcorn/markup");
const { setTenant, isAdmin, error_catcher } = require("./utils.js");
const {
  span,
  h5,
  h1,
  h4,
  nbsp,
  p,
  a,
  div,
  form,
  input,
  select,
  button,
  option,
  text,
  label,
} = require("@saltcorn/markup/tags");
const { csrfField } = require("./utils");
const { editRoleForm, fileUploadForm } = require("../markup/forms.js");
const { strictParseInt } = require("@saltcorn/data/plugin-helper");

/**
 * @type {object}
 * @const
 * @namespace filesRouter
 * @category server
 * @subcategory routes
 */
const router = new Router();
module.exports = router;

/**
 * @param {*} file 
 * @param {*} roles 
 * @param {*} req 
 * @returns {Form}
 */
const editFileRoleForm = (file, roles, req) =>
  editRoleForm({
    url: `/files/setrole/${file.id}`,
    current_role: file.min_role_read,
    roles,
    req,
  });

/**
 * @name get
 * @function
 * @memberof module:routes/files~filesRouter
 * @function
 */
router.get(
  "/",
  setTenant,
  isAdmin,
  error_catcher(async (req, res) => {
    const rows = await File.find({}, { orderBy: "filename" });
    const roles = await User.get_roles();
    res.sendWrap("Files", {
      above: [
        {
          type: "breadcrumbs",
          crumbs: [
            { text: req.__("Settings"), href: "/settings" },
            { text: req.__("Files") },
          ],
        },
        {
          type: "card",
          contents: [
            mkTable(
              [
                {
                  label: req.__("Filename"),
                  key: (r) =>
                    div(
                      { "data-inline-edit-dest-url": `/files/setname/${r.id}` },
                      r.filename
                    ),
                },
                { label: req.__("Size (KiB)"), key: "size_kb", align: "right" },
                { label: req.__("Media type"), key: (r) => r.mimetype },
                {
                  label: req.__("Role to access"),
                  key: (r) => editFileRoleForm(r, roles, req),
                },
                {
                  label: req.__("Link"),
                  key: (r) => link(`/files/serve/${r.id}`, req.__("Link")),
                },
                {
                  label: req.__("Download"),
                  key: (r) =>
                    link(`/files/download/${r.id}`, req.__("Download")),
                },
                {
                  label: req.__("Delete"),
                  key: (r) =>
                    post_delete_btn(`/files/delete/${r.id}`, req, r.filename),
                },
              ],
              rows,
              { hover: true }
            ),
            fileUploadForm(req),
          ],
        },
      ],
    });
  })
);

/**
 * @name get/download/:id
 * @function
 * @memberof module:routes/files~filesRouter
 * @function
 */
router.get(
  "/download/:id",
  setTenant,
  error_catcher(async (req, res) => {
    const role = req.isAuthenticated() ? req.user.role_id : 10;
    const user_id = req.user && req.user.id;
    const { id } = req.params;
    const file = await File.findOne({ id });
    if (role <= file.min_role_read || (user_id && user_id === file.user_id)) {
      res.type(file.mimetype);
      s3storage.serveObject(file, res, true);
      //res.download(file.location, file.filename);
    } else {
      req.flash("warning", req.__("Not authorized"));
      res.redirect("/");
    }
  })
);

/**
 * @name get/serve/:id
 * @function
 * @memberof module:routes/files~filesRouter
 * @function
 */
router.get(
  "/serve/:id",
  setTenant,
  error_catcher(async (req, res) => {
    const role = req.isAuthenticated() ? req.user.role_id : 10;
    const user_id = req.user && req.user.id;
    const { id } = req.params;
    let file;
    if (typeof strictParseInt(id) !== "undefined")
      file = await File.findOne({ id });
    else file = await File.findOne({ filename: id });

    if (!file) {
      res
        .status(404)
        .sendWrap(req.__("Not found"), h1(req.__("File not found")));
      return;
    }
    if (role <= file.min_role_read || (user_id && user_id === file.user_id)) {
      res.type(file.mimetype);
      const cacheability = file.min_role_read === 10 ? "public" : "private";
      res.set("Cache-Control", `${cacheability}, max-age=86400`);
      //res.sendFile(file.location);
      s3storage.serveObject(file, res, false);
    } else {
      req.flash("warning", req.__("Not authorized"));
      res.redirect("/");
    }
  })
);

/**
 * @name post/setrole/:id
 * @function
 * @memberof module:routes/files~filesRouter
 * @function
 */
router.post(
  "/setrole/:id",
  setTenant,
  isAdmin,
  error_catcher(async (req, res) => {
    const { id } = req.params;
    const role = req.body.role;
    await File.update(+id, { min_role_read: role });
    const file = await File.findOne({ id });
    const roles = await User.get_roles();
    const roleRow = roles.find((r) => r.id === +role);
    if (roleRow && file)
      req.flash(
        "success",
        req.__(`Minimum role for %s updated to %s`, file.filename, roleRow.role)
      );
    else req.flash("success", req.__(`Minimum role updated`));

    res.redirect("/files");
  })
);

/**
 * @name post/setname/:id
 * @function
 * @memberof module:routes/files~filesRouter
 * @function
 */
router.post(
  "/setname/:id",
  setTenant,
  isAdmin,
  error_catcher(async (req, res) => {
    const { id } = req.params;
    const filename = req.body.value;
    await File.update(+id, { filename });

    res.redirect("/files");
  })
);

/**
 * @name post/upload
 * @function
 * @memberof module:routes/files~filesRouter
 * @function
 */
router.post(
  "/upload",
  setTenant,
  error_catcher(async (req, res) => {
    let jsonResp = {};
    const min_role_upload = getState().getConfig("min_role_upload", 1);
    const role = req.isAuthenticated() ? req.user.role_id : 10;
    if (role > +min_role_upload) {
      if (!req.xhr) req.flash("warning", req.__("Not authorized"));
      else jsonResp = { error: "Not authorized" };
    } else if (!req.files || !req.files.file) {
      if (!req.xhr) req.flash("warning", req.__("No file found"));
      else jsonResp = { error: "No file found" };
    } else {
      const min_role_read = req.body ? req.body.min_role_read || 1 : 1;
      const f = await File.from_req_files(
        req.files.file,
        req.user.id,
        +min_role_read
      );
      const many = Array.isArray(f);
      if (!req.xhr)
        req.flash(
          "success",
          req.__(
            `File %s uploaded`,
            many
              ? f.map((fl) => text(fl.filename)).join(", ")
              : text(f.filename)
          )
        );
      else
        jsonResp = {
          success: {
            filename: many ? f.map((fl) => fl.filename) : f.filename,
            id: many ? f.map((fl) => fl.id) : f.id,
            url: many
              ? f.map((fl) => `/files/serve/${fl.id}`)
              : `/files/serve/${f.id}`,
          },
        };
    }
    if (!req.xhr) res.redirect("/files");
    else res.json(jsonResp);
  })
);

/**
 * @name post/delete/:id
 * @function
 * @memberof module:routes/files~filesRouter
 * @function
 */
router.post(
  "/delete/:id",
  setTenant,
  isAdmin,
  error_catcher(async (req, res) => {
    const { id } = req.params;
    const f = await File.findOne({ id });
    const result = await f.delete(s3storage.unlinkObject);
    if (result && result.error) {
      req.flash("error", result.error);
    } else {
      req.flash("success", req.__(`File %s deleted`, text(f.filename)));
    }
    res.redirect(`/files`);
  })
);
