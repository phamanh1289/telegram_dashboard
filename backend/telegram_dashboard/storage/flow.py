"""UI flow render jobs (YouTrack) and their event log."""

import json


class FlowJobs:
    def flow_job_create(self, scope, job, issue="", base=None, request=None):
        with self._conn(write=True) as c:
            c.execute("INSERT OR IGNORE INTO flow_jobs(scope,id,issue,status,base,request,created_at,updated_at) "
                      "VALUES(?,?,?,'queued',?,?,unixepoch(),unixepoch())",
                      (scope, job, issue, base, json.dumps(request) if request else None))
            return c.execute("SELECT changes()").fetchone()[0] == 1

    def flow_job_get(self, scope, job=None, issue=None):
        with self._conn() as c:
            rows = c.execute("SELECT *, (SELECT COALESCE(MAX(cursor),0) FROM flow_job_events e "
                             "WHERE e.scope=f.scope AND e.job=f.id) cursor FROM flow_jobs f "
                             "WHERE scope=? AND (? IS NULL OR id=?) AND (? IS NULL OR issue=?) "
                             "ORDER BY created_at DESC, rowid DESC", (scope, job, job, issue, issue)).fetchall()
            result = []
            for row in rows:
                data = dict(row)
                data.pop("scope")
                data.pop("checkpoint")
                for key in ("result", "error", "request"):
                    data[key] = json.loads(data[key]) if data[key] else None
                data["processed"] = bool(data["processed"])
                data["needs_ai_retry"] = data["status"] == "interrupted"
                result.append(data)
            return (result[0] if result else None) if job else result

    def flow_job_update(self, scope, job, **values):
        allowed = {"status", "stage", "checkpoint", "result", "error", "processed"}
        if not values.keys() <= allowed:
            raise ValueError("Invalid flow job fields")
        values = {k: json.dumps(v, ensure_ascii=False) if k in ("checkpoint", "result", "error") else v
                  for k, v in values.items()}
        with self._conn(write=True) as c:
            c.execute("UPDATE flow_jobs SET " + ",".join(k + "=?" for k in values) +
                      ",updated_at=unixepoch() WHERE scope=? AND id=?", (*values.values(), scope, job))

    def flow_job_event(self, scope, job, payload):
        with self._conn(write=True) as c:
            state = c.execute("SELECT status FROM flow_jobs WHERE scope=? AND id=?", (scope, job)).fetchone()
            if state is None or state[0] not in ("queued", "running"):
                return None
            if "done" in payload:
                c.execute("UPDATE flow_jobs SET status='succeeded',result=?,stage='done',updated_at=unixepoch() "
                          "WHERE scope=? AND id=?", (json.dumps(payload["done"], ensure_ascii=False), scope, job))
            elif "error" in payload:
                c.execute("UPDATE flow_jobs SET status='failed',error=?,updated_at=unixepoch() WHERE scope=? AND id=?",
                          (json.dumps(payload["error"], ensure_ascii=False), scope, job))
            elif "step" in payload:
                c.execute("UPDATE flow_jobs SET stage=?,updated_at=unixepoch() WHERE scope=? AND id=?",
                          (payload["step"].get("stage", "ai"), scope, job))
            cursor = c.execute("SELECT COALESCE(MAX(cursor),0)+1 FROM flow_job_events WHERE scope=? AND job=?",
                               (scope, job)).fetchone()[0]
            c.execute("INSERT INTO flow_job_events VALUES(?,?,?,?)",
                      (scope, job, cursor, json.dumps(payload, ensure_ascii=False)))
            return cursor

    def flow_job_events(self, scope, job, after):
        with self._conn() as c:
            return [json.loads(r[1]) | {"cursor": r[0]} for r in c.execute(
                "SELECT cursor,payload FROM flow_job_events WHERE scope=? AND job=? AND cursor>? ORDER BY cursor",
                (scope, job, after))]

    def flow_jobs_recover(self):
        with self._conn(write=True) as c:
            c.execute("DELETE FROM flow_jobs WHERE processed=1 AND updated_at<unixepoch()-2592000 "
                      "AND status NOT IN ('queued','running','cancel_requested')")
            rows = c.execute("SELECT scope,id,status,checkpoint,result FROM flow_jobs "
                             "WHERE status IN ('queued','running','cancel_requested')").fetchall()
            for scope, job, status, checkpoint, saved_result in rows:
                if status == "cancel_requested":
                    state, result = "cancelled", None
                elif checkpoint:
                    # Revalidate persisted data before safely completing code-only recovery.
                    from ..youtrack.flow import Flow
                    try:
                        result = {"flow": Flow.model_validate_json(checkpoint).model_dump()}
                        saved = json.loads(saved_result) if saved_result else None
                        if isinstance(saved, dict) and saved.get("flow") == result["flow"]:
                            result = saved
                        state = "succeeded"
                    except ValueError:
                        state, result = "interrupted", None
                else:
                    state, result = "interrupted", None
                c.execute("UPDATE flow_jobs SET status=?,result=?,updated_at=unixepoch() WHERE scope=? AND id=?",
                          (state, json.dumps(result) if result else None, scope, job))
