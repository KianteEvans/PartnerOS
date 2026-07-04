import type { CSSProperties, ReactNode } from "react";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { createPlaybook } from "@/domain/playbooks/actions";
import { ACTION_CATALOG, PLAYBOOK_ACTION_TYPES } from "@/domain/playbooks/catalog";
import { SITUATION_LABELS } from "@/domain/command/brief";

/**
 * "New playbook" drawer — trigger situation -> action, gated by the workspace
 * automation mode. Every field shows; the action reads only the ones its action
 * type needs (route needs an owner, approve needs a cap, notify needs channels).
 */

const control: CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
};
const label: CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
const span: CSSProperties = { fontWeight: 600, color: "var(--muted)" };
const row: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" };
const hint: CSSProperties = { fontSize: 11.5, color: "var(--muted)" };

export function NewPlaybookDrawer({ members }: { members: ReadonlyArray<{ id: string; email: string }> }): ReactNode {
  return (
    <FormDrawer
      triggerLabel="New playbook"
      triggerVariant="primary"
      title="New playbook"
      action={createPlaybook}
      submitLabel="Create playbook"
      successMessage="Playbook created."
    >
      <label style={label}>
        <span style={span}>Name</span>
        <input name="name" required maxLength={120} placeholder="e.g. Chase funding deadlines" style={control} />
      </label>
      <label style={label}>
        <span style={span}>Description</span>
        <input name="description" maxLength={500} placeholder="What this automation does" style={control} />
      </label>

      <div style={row}>
        <label style={{ ...label, flex: 2, minWidth: 200 }}>
          <span style={span}>When this happens (trigger)</span>
          <select name="triggerSituation" required style={control} defaultValue="funding_deadline">
            {Object.entries(SITUATION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...label, flex: 1, minWidth: 120 }}>
          <span style={span}>At severity ≥</span>
          <select name="triggerMinSeverity" defaultValue="medium" style={control}>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
      </div>

      <label style={label}>
        <span style={span}>Do this (action)</span>
        <select name="actionType" required style={control} defaultValue="notify">
          {PLAYBOOK_ACTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTION_CATALOG[t].label}
            </option>
          ))}
        </select>
        <span style={hint}>
          Route needs an owner; Approve needs a cap and only applies to MDF/Funding deadlines; Route only applies to AWS
          review. High-risk actions wait for approval unless your automation mode allows them.
        </span>
      </label>

      <div style={row}>
        <label style={{ ...label, flex: 2, minWidth: 200 }}>
          <span style={span}>Title (task / report)</span>
          <input name="title" maxLength={200} placeholder="Leave blank to auto-title" style={control} />
        </label>
        <label style={{ ...label, flex: 1, minWidth: 120 }}>
          <span style={span}>Priority (task)</span>
          <select name="priority" defaultValue="medium" style={control}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
      </div>

      <div style={row}>
        <label style={{ ...label, flex: 1, minWidth: 160 }}>
          <span style={span}>Owner (route)</span>
          <select name="ownerUserId" defaultValue="" style={control}>
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.email}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...label, flex: 1, minWidth: 160 }}>
          <span style={span}>Approve cap USD (approve)</span>
          <input name="cap" type="number" min={0} defaultValue={0} style={control} />
        </label>
      </div>

      <div style={{ ...label }}>
        <span style={span}>Notify channels</span>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="channels" value="in_app" defaultChecked /> In-app
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="channels" value="email" /> Email
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="channels" value="webhook" /> Webhook
          </label>
        </div>
        <span style={hint}>Email/webhook are high-risk external sends and follow the same approval gate.</span>
      </div>
    </FormDrawer>
  );
}
