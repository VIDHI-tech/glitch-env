const app = document.querySelector("#app");
let me = null,
  dashboard = null,
  cleanup = () => {},
  workTab = "drafts",
  renderId = 0;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (v) =>
  new Date(v).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const time = (v) =>
  `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, "0")}`;
const label = (v) => String(v).replaceAll("_", " ");
const icons = { video: "▷", exercise: "✎", feedback: "◇", reflection: "↗" };
function toast(message) {
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 4500);
}
async function api(path, method = "GET", body) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(method !== "GET"
        ? { "Content-Type": "application/json", "X-CSRF-Token": me?.csrf || "" }
        : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}
const link = (unit, text = "Continue learning →", cls = "button") =>
  `<a class="${cls}" href="#lesson/${esc(unit.id)}">${text}</a>`;
function empty(title, text) {
  return `<div class="empty"><h3>${title}</h3><span>${text}</span></div>`;
}
function shell(content, active = "dashboard") {
  const student = me.role === "student";
  const nav = student
    ? [
        ["dashboard", "◫", "My GLITCH"],
        ["roadmap", "⌁", "My roadmap"],
        ["work", "▣", "My Work"],
      ]
    : [
        ["staff", "◫", "Students & reviews"],
        ...(me.role === "admin" ? [["admin", "⌁", "Course management"]] : []),
      ];
  app.innerHTML = `<div class="shell"><aside class="sidebar"><a class="wordmark" href="#${student ? "dashboard" : "staff"}">GLITCH<span>•</span></a><div class="eyebrow">${student ? "Your learning space" : "Teaching workspace"}</div><nav class="nav" aria-label="Main navigation">${nav.map(([href, icon, title]) => `<a class="${active === href ? "active" : ""}" href="#${href}" ${active === href ? 'aria-current="page"' : ""}><span class="nav-icon" aria-hidden="true">${icon}</span>${title}</a>`).join("")}</nav><div class="side-bottom"><div class="account"><span class="avatar">${esc(me.name.slice(0, 2).toUpperCase())}</span><div>${esc(me.name)}<small>${student ? "Student workspace" : esc(me.role)}</small></div></div><button class="secondary small" id="logout">Sign out ↗</button></div></aside><main class="main"><header class="topbar"><span><span class="mobile-brand wordmark">GLITCH<span>•</span></span><span class="desktop-breadcrumb">${student ? "Your journey. Your pace." : "GLITCH / Learning operations"}</span></span><small><span class="live-dot">●</span>Personal workspace · synced to your account</small></header><div class="content">${content}</div></main></div>`;
  document.querySelector("#logout").onclick = async () => {
    try {
      cleanup();
      await api("/auth/logout", "POST", {});
      me = null;
      location.hash = "login";
      render();
    } catch (e) {
      toast(e.message);
    }
  };
}
function auth(register = false) {
  app.innerHTML = `<main class="auth"><section class="auth-brand"><div class="wordmark">GLITCH<span>•</span></div><div><div class="eyebrow">A different way to learn</div><h1>See differently.<br>Think deeper.<br>Make your mark.</h1><p>A personal space for your questions, discoveries, and the work that moves you forward.</p><div class="auth-art" aria-hidden="true"><i>▷</i><b></b><i>✎</i><b></b><i>✓</i></div></div><div class="eyebrow">Your learning journey starts here.</div></section><section class="auth-form"><div class="eyebrow">My GLITCH</div><h2>${register ? "Make space for your next idea." : "Welcome back."}</h2><p>${register ? "Create your private learning workspace." : "Pick up exactly where you left off."}</p><form id="auth-form">${register ? '<div class="field"><label for="name">Your name</label><input id="name" name="name" autocomplete="name" required maxlength="100"></div>' : ""}<div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="password">Password ${register ? "(at least 12 characters)" : ""}</label><input id="password" name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" minlength="${register ? 12 : 1}" maxlength="200" required></div><p class="error" id="auth-error" role="alert"></p><button type="submit">${register ? "Create my workspace" : "Sign in to GLITCH"} →</button></form><a class="switch" href="#${register ? "login" : "register"}">${register ? "Already have an account? Sign in" : "New to GLITCH? Create your workspace"}</a></section></main>`;
  document.querySelector("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button");
    button.disabled = true;
    try {
      me = await api(
        `/auth/${register ? "register" : "login"}`,
        "POST",
        Object.fromEntries(new FormData(e.target)),
      );
      location.hash = me.role === "student" ? "dashboard" : "staff";
    } catch (error) {
      document.querySelector("#auth-error").textContent = error.message;
      button.disabled = false;
    }
  };
}
function history(items, limit = 12) {
  return items.length
    ? items
        .slice(0, limit)
        .map(
          (a) =>
            `<div class="activity"><span class="activity-dot"></span><div><strong>${esc(label(a.event))}${a.detail ? ` · ${esc(a.detail)}` : ""}</strong><small>${date(a.created_at)}</small></div></div>`,
        )
        .join("")
    : empty("A fresh start", "Your activity will appear here as you learn.");
}
function overview(data, staff = false) {
  const courses = data.courses,
    all = courses.flatMap((c) => c.units),
    current = courses.find((c) => c.current),
    total = courses.reduce((n, c) => n + c.total, 0),
    done = courses.reduce((n, c) => n + c.completed, 0),
    pending = all.filter((u) => u.exercise_status === "submitted").length;
  return `<div class="intro"><div><div class="eyebrow">${staff ? "Individual student progress" : "My GLITCH / Overview"}</div><h1>${staff ? "Learning journey" : `Welcome back, ${esc(me.name.split(" ")[0])}.`}</h1><p>${staff ? "Progress and history for this assigned course." : "A little curiosity. A little practice. A step forward."}</p></div><span class="pill green">${courses.length} enrolled course${courses.length === 1 ? "" : "s"}</span></div>
 ${current ? `<section class="hero"><div><div class="eyebrow">${esc(current.current.week_title)} · ${esc(current.current.day_title)}</div><h2>${esc(current.current.title)}</h2><p>${current.current.kind === "video" ? `You’ve watched ${current.current.watched_percentage}%. ${current.current.last_position ? `Resume at ${time(current.current.last_position)}.` : "Your next lesson is ready."}` : current.current.exercise_status === "submitted" ? "Your work is with your instructor. You’ll continue once it’s approved." : "Your next step is waiting. Continue your personal learning path."}</p>${staff ? "" : link(current.current)}</div><div class="hero-graphic"><strong>${current.percentage}<small>%</small></strong><small>COURSE COMPLETE</small></div></section>` : `<div class="card">${empty(courses.length ? "You’re up to date" : "Your workspace is ready", courses.length ? "Revisit your completed lessons and explore your saved work." : "Your instructor will assign your course. Your progress, notes, and work will live here.")}</div>`}
 <div class="stats"><div class="stat"><small>Course progress</small><strong>${total ? Math.round((done / total) * 100) : 0}%</strong><small>Of your assigned required units</small></div><div class="stat"><small>Learning blocks</small><strong>${done}<small> / ${total}</small></strong><small>${total - done} remaining</small></div><div class="stat"><small>Exercises completed</small><strong>${all.filter((u) => u.kind === "exercise" && u.state === "completed").length}</strong><small>${all.filter((u) => u.kind === "exercise" && u.state !== "completed").length} pending</small></div><div class="stat"><small>Awaiting feedback</small><strong>${pending}</strong><small>Submitted for instructor review</small></div></div>
 <div class="columns"><section><div class="card-header"><h2>${staff ? "Assigned course" : "Your courses"}</h2>${staff ? "" : '<a class="muted" href="#roadmap">View roadmap ↗</a>'}</div>${courses.map((c) => `<article class="card course-card"><div class="course-top"><div class="course-icon">⌁</div><span class="pill">${c.completed_days} / ${c.days.length} days</span></div><h3>${esc(c.course.title)}</h3><p>${esc(c.course.description)}</p><progress value="${c.completed}" max="${c.total || 1}" aria-label="Course completion"></progress><div class="meta-row"><span>${c.completed} of ${c.total} required blocks</span><span>${c.percentage}% complete</span></div><div class="divider"></div>${c.days.map((d) => `<div class="row"><span>${esc(d.week)}<br><strong>${esc(d.title)}</strong></span><span class="pill">${d.percentage}%</span></div>`).join("")}${!staff ? `<div class="actions">${c.current ? link(c.current, "Continue course →") : ""}<a class="button secondary" href="#roadmap/${c.course_id}">Explore roadmap</a></div>` : ""}</article>`).join("")}<div class="card"><h2>Recent instructor feedback</h2>${
   data.feedback.length
     ? data.feedback
         .slice(0, 5)
         .map(
           (f) =>
             `<div class="row"><div><strong>${esc(f.title)} · Attempt ${f.attempt}</strong><p>${esc(f.message)}</p><small class="muted">${esc(f.reviewer)} · ${date(f.created_at)}</small></div><span class="pill">${esc(label(f.decision))}</span></div>`,
         )
         .join("")
     : empty("Room to grow", "Your instructor’s feedback will appear here.")
 }</div></section><aside><div class="card"><h2>Learning history</h2>${history(data.history)}${!staff ? '<a class="button secondary small" href="#history">View full learning history →</a>' : ""}</div>${!staff ? '<div class="card"><div class="eyebrow">Your ideas belong here</div><h3>Keep your work close.</h3><p>Drafts, notes, revisions, and finished projects. All in your personal space.</p><a class="button secondary" href="#work">Open My Work ↗</a></div>' : ""}</aside></div>${staff ? `<div class="card"><h2>Learning block details</h2><div class="table-scroll"><table><thead><tr><th>Learning unit</th><th>Status</th><th>Video watched</th><th>Last position</th></tr></thead><tbody>${all.map((u) => `<tr><td>${esc(u.title)}</td><td>${esc(u.kind === "exercise" ? label(u.exercise_status) : u.state)}</td><td>${u.kind === "video" ? u.watched_percentage + "%" : "—"}</td><td>${u.kind === "video" ? time(u.last_position) : "—"}</td></tr>`).join("")}</tbody></table></div></div>` : ""}`;
}
function roadmap(data, courseId) {
  const c =
    data.courses.find((x) => x.course_id === courseId) || data.courses[0];
  if (!c) {
    shell(
      `<h1>Your roadmap</h1>${empty("Your journey is taking shape", "Your instructor will assign a published learning path.")}`,
      "roadmap",
    );
    return;
  }
  shell(
    `<div class="intro"><div><div class="eyebrow">Your learning path</div><h1>${esc(c.course.title)}</h1><p>Follow your curiosity. One learning block at a time.</p></div><span class="pill purple">${c.percentage}% complete</span></div>${data.courses.length > 1 ? `<div class="tabs">${data.courses.map((x) => `<a class="button secondary" href="#roadmap/${x.course_id}">${esc(x.course.title)}</a>`).join("")}</div>` : ""}<div class="road-layout"><section>${
      c.days
        .map((d) => {
          const units = c.units.filter((u) => u.day_id === d.id);
          let chapter = "";
          return `<div class="day-header"><div class="eyebrow">${esc(d.week)}</div><h2>${esc(d.title)}</h2><div class="meta-row"><span>${d.completed} of ${d.total} required blocks completed</span><span>${d.percentage}%</span></div><progress value="${d.completed}" max="${d.total || 1}" aria-label="Day completion"></progress></div>${units
            .map((u) => {
              let heading = "";
              if (chapter !== u.chapter_id) {
                chapter = u.chapter_id;
                heading = `<h3 class="chapter-title">${esc(u.chapter_title)}</h3>`;
              }
              const inner = `<span class="node-title">${esc(u.title)}</span><p>${esc(u.kind)}${u.kind === "video" ? ` · ${time(u.last_position)} / ${time(u.duration)} · ${u.watched_percentage}% watched` : ""} · ${u.kind === "exercise" ? esc(label(u.exercise_status)) : label(u.state)}${!u.required ? " · optional" : ""}</p>`;
              return `${heading}<div class="node ${u.state}" ${u.id === c.current?.id ? 'id="current-node"' : ""}><span class="node-icon" aria-hidden="true">${u.state === "completed" ? "✓" : u.state === "locked" ? "·" : icons[u.kind]}</span>${u.state === "locked" ? `<div>${inner}</div>` : `<a href="#lesson/${u.id}">${inner}</a>`}</div>`;
            })
            .join("")}`;
        })
        .join("") ||
      empty(
        "No published lessons assigned",
        "Your instructor can add reviewed content to your enrollment.",
      )
    }</section><aside class="sticky"><div class="card"><span class="pill purple">${c.current ? "Your next step" : "Your progress"}</span><h2>${esc(c.current?.title || "All assigned blocks complete")}</h2><p>${c.current ? "Only your progress unlocks your next learning block. Completed lessons are always here to revisit." : "Return to any completed lesson to refresh your understanding."}</p>${c.current ? link(c.current) : '<a class="button" href="#work">Explore My Work</a>'}<div class="divider"></div><div class="meta-row"><span>Required blocks</span><strong>${c.completed} / ${c.total}</strong></div><progress value="${c.completed}" max="${c.total || 1}" aria-label="Course progress"></progress></div></aside></div>`,
    "roadmap",
  );
  document
    .querySelector("#current-node")
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
function submissionMarkup(s) {
  return `<article class="card saved-work"><div class="card-header"><h3>${esc(s.unit_title || "Submission")} · Attempt ${s.attempt}</h3><span class="pill ${s.status === "completed" ? "green" : "purple"}">${esc(label(s.status))}</span></div><small class="muted">${date(s.created_at)}</small><pre>${esc(s.answer)}</pre>${s.feedback.map((f) => `<div class="notice"><strong>Instructor feedback</strong><br>${esc(f.message)}</div>`).join("")}</article>`;
}
async function lesson(unitId) {
  const u = await api(`/units/${unitId}`);
  const submitted = u.submissions?.[0],
    editable = !submitted || submitted.status === "needs_revision";
  shell(
    `<div class="breadcrumbs"><a href="#roadmap">← My roadmap</a> / ${esc(u.week_title)} / ${esc(u.day_title)} / ${esc(u.chapter_title)}</div><div class="lesson-header"><span class="pill ${u.state === "completed" ? "green" : "purple"}">${esc(u.kind)} · ${esc(label(u.kind === "exercise" ? u.exercise_status : u.state))}</span><h1>${esc(u.title)}</h1></div><div class="columns"><section>${u.kind === "video" ? `<div class="card"><video id="video" class="lesson-video" controls playsinline preload="metadata" src="${esc(u.media_url)}"></video>${u.last_position ? `<div class="notice" id="resume-notice">You left off at ${time(u.last_position)}. <button id="resume" class="small">Resume at ${time(u.last_position)}</button></div>` : ""}<div class="player-meta"><span id="watch-state">${u.watched_percentage}% watched · saved at ${time(u.last_position)}</span><label>Speed <select id="speed"><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label></div><p>Watch at least 90% and reach the end to complete this lesson.</p></div>` : ""}<div class="card"><h2>${u.kind === "exercise" ? "Your brief & success criteria" : "Lesson material"}</h2><div class="lesson-body">${esc(u.content)}</div></div>${u.kind === "exercise" ? `<div class="card"><h2>${submitted?.status === "needs_revision" ? "Revise your response" : "Your response"}</h2>${u.requires_review ? '<div class="notice">This exercise requires instructor approval before your next block unlocks.</div>' : ""}${editable ? `<form id="exercise-form"><div class="field"><label for="answer">Your work</label><textarea id="answer" name="answer" rows="12" required>${esc(u.draft?.answer ?? (submitted?.status === "needs_revision" ? submitted.answer : ""))}</textarea></div><div class="actions"><button type="button" class="secondary" id="save-draft">Save draft</button><button type="submit">Submit for ${u.requires_review ? "review" : "completion"} →</button><small id="draft-state" class="muted">${u.draft ? `Saved ${date(u.draft.updated_at)}` : "Your response is private."}</small></div></form>` : `<p>${submitted.status === "submitted" ? "Your submission is awaiting instructor review." : "This exercise is complete. Your original answer is preserved below."}</p>`}</div>${u.submissions.map(submissionMarkup).join("")}` : ""}${["reflection", "feedback"].includes(u.kind) && u.state !== "completed" ? '<button id="acknowledge">Mark as complete →</button>' : ""}<div class="card"><h2>Next in your journey</h2><p>Your roadmap updates as you complete required blocks.</p><a class="button secondary" href="#roadmap">View updated roadmap →</a></div></section><aside><div class="card"><h2>Lesson notes</h2><p>Just for you. Saved to your account.</p><div class="field"><label for="note">Your observations and questions</label><textarea id="note" rows="8">${esc(u.note?.body || "")}</textarea></div><button id="save-note" class="secondary">Save note</button><p id="note-state" class="muted"></p></div><div class="card"><h2>Save to My Work</h2><p>Keep a deliverable, a project, or code to revisit later.</p><form id="artifact-form"><div class="field"><label for="artifact-title">Title</label><input id="artifact-title" name="title" required maxlength="200"></div><div class="field"><label for="artifact-kind">Work type</label><select id="artifact-kind" name="kind"><option value="deliverable">Deliverable</option><option value="project">Project</option><option value="code">Saved code</option></select></div><div class="field"><label for="artifact-body">Project content / code</label><textarea id="artifact-body" name="body"></textarea></div><div class="field"><label for="artifact-file">Supporting file (up to 20 MB)</label><input id="artifact-file" type="file"></div><p class="muted">Code is saved as private text. It is never executed.</p><button type="submit">Save to My Work</button></form></div></aside></div>`,
    "roadmap",
  );
  let draftRevision = u.draft?.revision || 0,
    noteRevision = u.note?.revision || 0;
  const saveDraft = async () => {
    const d = await api(`/units/${unitId}/draft`, "POST", {
      answer: document.querySelector("#answer").value,
      revision: draftRevision,
    });
    draftRevision = d.revision;
    document.querySelector("#draft-state").textContent =
      `Saved ${date(d.updated_at)}`;
    toast("Draft saved to your account");
  };
  const saveButton = document.querySelector("#save-draft");
  if (saveButton)
    saveButton.onclick = () => saveDraft().catch((e) => toast(e.message));
  const exercise = document.querySelector("#exercise-form");
  if (exercise)
    exercise.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/units/${unitId}/submit`, "POST", {
          answer: document.querySelector("#answer").value,
        });
        toast("Your response has been submitted");
        await render();
      } catch (error) {
        toast(error.message);
      }
    };
  document.querySelector("#save-note").onclick = async () => {
    try {
      const n = await api(`/units/${unitId}/note`, "POST", {
        body: document.querySelector("#note").value,
        revision: noteRevision,
      });
      noteRevision = n.revision;
      document.querySelector("#note-state").textContent =
        `Saved ${date(n.updated_at)}`;
      toast("Note saved");
    } catch (e) {
      toast(e.message);
    }
  };
  const ack = document.querySelector("#acknowledge");
  if (ack)
    ack.onclick = async () => {
      try {
        await api(`/units/${unitId}/acknowledge`, "POST", {});
        toast("Learning block completed");
        location.hash = "roadmap";
      } catch (e) {
        toast(e.message);
      }
    };
  document.querySelector("#artifact-form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button");
    button.disabled = true;
    try {
      const b = Object.fromEntries(new FormData(e.target));
      b.unit_id = unitId;
      const file = document.querySelector("#artifact-file").files[0];
      if (file) {
        if (file.size > 20 * 1024 * 1024)
          throw new Error("Files must be 20 MB or smaller");
        const r = await fetch(`/api/files?unit=${unitId}`, {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": file.name,
            "X-CSRF-Token": me.csrf,
          },
          body: file,
        });
        const f = await r.json();
        if (!r.ok) throw new Error(f.error);
        b.file_id = f.id;
      }
      await api("/artifacts", "POST", b);
      toast("Saved to My Work");
      e.target.reset();
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  };
  if (u.kind === "video") setupPlayer(u);
}
function setupPlayer(u) {
  const video = document.querySelector("#video");
  let playbackId = null,
    queue = Promise.resolve(),
    stopped = false,
    seeking = false;
  const enqueue = (fn) => {
    queue = queue.then(fn).catch((e) => {
      toast(e.message);
      if (e.status === 409) {
        video.pause();
        playbackId = null;
      }
    });
    return queue;
  };
  const start = () =>
    enqueue(async () => {
      const data = await api(`/units/${u.id}/playback`, "POST", {
        position: video.currentTime,
      });
      playbackId = data.playbackId;
    });
  const send = (event, keepalive = false) => {
    const position = video.currentTime;
    return enqueue(async () => {
      if (!playbackId) return;
      const r = await fetch(`/api/units/${u.id}/heartbeat`, {
        method: "POST",
        keepalive,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me?.csrf || "",
        },
        body: JSON.stringify({ playbackId, position, event }),
      });
      const result = await r.json();
      if (!r.ok) {
        const e = new Error(result.error);
        e.status = r.status;
        throw e;
      }
      const status = document.querySelector("#watch-state");
      if (status && !stopped)
        status.textContent = `${result.watched_percentage}% watched · saved at ${time(position)}${result.completed ? " · Completed ✓" : ""}`;
    });
  };
  video.addEventListener("play", start);
  video.addEventListener("pause", () => {
    if (!seeking && !stopped) send("pause");
  });
  video.addEventListener("seeking", () => {
    seeking = true;
  });
  video.addEventListener("seeked", () => {
    seeking = false;
    if (playbackId) send("seek");
    else start();
  });
  video.addEventListener("ended", () => send("ended"));
  const timer = setInterval(() => {
    if (!video.paused && !video.seeking && !stopped) send("playing");
  }, 5000);
  document.querySelector("#speed").onchange = (e) => {
    video.playbackRate = Number(e.target.value);
  };
  const resume = document.querySelector("#resume");
  if (resume)
    resume.onclick = () => {
      video.currentTime = u.last_position;
      video.play();
      document.querySelector("#resume-notice").remove();
    };
  const leave = () => {
    if (!stopped) send(video.seeking ? "seek" : "pause", true);
  };
  window.addEventListener("pagehide", leave);
  cleanup = () => {
    leave();
    stopped = true;
    clearInterval(timer);
    video.pause();
    window.removeEventListener("pagehide", leave);
    cleanup = () => {};
  };
}
async function work() {
  const data = await api("/work");
  const tabs = [
    ["drafts", "Drafts"],
    ["submissions", "Submissions"],
    ["notes", "Lesson notes"],
    ["artifacts", "Portfolio & projects"],
  ];
  shell(
    `<div class="intro"><div><div class="eyebrow">Your personal workspace</div><h1>My Work</h1><p>Every idea, every iteration, every step forward. All yours.</p></div><span class="pill">Private to your account</span></div><div class="tabs" role="tablist">${tabs.map(([key, title]) => `<button role="tab" aria-selected="${workTab === key}" class="${workTab === key ? "active" : ""}" data-tab="${key}">${title} <span>${data[key].length}</span></button>`).join("")}</div><section id="work-list">${
      data[workTab].length
        ? data[workTab]
            .map((row) => {
              const context = `<div class="eyebrow">${esc(row.course_title)} / ${esc(row.day_title)}</div>`;
              if (workTab === "submissions")
                return context + submissionMarkup(row);
              return `<article class="card saved-work">${context}<div class="card-header"><h2>${esc(row.title || row.unit_title)}</h2><span class="pill">${workTab === "artifacts" ? esc(row.kind) : workTab === "drafts" ? "Draft" : "Note"}</span></div><small class="muted">Saved ${date(row.updated_at)}</small><pre>${esc(row.answer ?? row.body)}</pre><div class="actions">${link({ id: row.unit_id }, workTab === "drafts" ? "Continue exercise →" : "Revisit lesson →", "button secondary")}${row.file_id ? `<a class="button secondary" href="/api/files/${row.file_id}">Download ${esc(row.file_name)}</a>` : ""}${workTab === "artifacts" ? `<button class="secondary" data-edit="${row.id}">Edit saved work</button>` : ""}</div>${workTab === "artifacts" ? `<form class="hidden" data-artifact="${row.id}"><div class="field"><label>Project title<input name="title" required value="${esc(row.title)}"></label></div><div class="field"><label>Content / saved code<textarea name="body" class="code-editor">${esc(row.body)}</textarea></label></div><button type="submit">Save changes</button></form>` : ""}</article>`;
            })
            .join("")
        : empty(
            `No ${tabs.find((t) => t[0] === workTab)[1].toLowerCase()} yet`,
            "Open a lesson to save your work here.",
          )
    }</section>`,
    "work",
  );
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        workTab = b.dataset.tab;
        work().catch((e) => toast(e.message));
      }),
  );
  document
    .querySelectorAll("[data-edit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          document
            .querySelector(`[data-artifact="${b.dataset.edit}"]`)
            .classList.toggle("hidden")),
    );
  document.querySelectorAll("[data-artifact]").forEach(
    (form) =>
      (form.onsubmit = async (e) => {
        e.preventDefault();
        const old = data.artifacts.find((a) => a.id === form.dataset.artifact);
        try {
          await api("/artifacts", "POST", {
            ...old,
            ...Object.fromEntries(new FormData(form)),
          });
          toast("Project saved");
          await work();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
}
async function staff() {
  const data = await api("/staff");
  shell(
    `<div class="intro"><div><div class="eyebrow">Teaching workspace</div><h1>Students & reviews</h1><p>Your assigned students, their individual journeys, and work awaiting your feedback.</p></div><span class="pill purple">${data.submissions.length} awaiting review</span></div><div class="card"><h2>Assigned students</h2>${data.students.length ? data.students.map((s) => `<div class="row"><div><strong>${esc(s.name)}</strong><p>${esc(s.email)} · ${esc(s.course_title)} · ${esc(s.status)}</p></div><div class="actions"><a class="button secondary small" href="#student/${s.id}/${s.course_id}">View progress</a>${me.role === "admin" ? `<button class="secondary small" data-suspend="${s.id}" data-course="${s.course_id}">${s.status === "suspended" ? "Restore access" : "Suspend access"}</button>` : ""}</div></div>`).join("") : empty("No assigned students", "An administrator can assign students to you.")}</div><h2>Submissions to review</h2>${data.submissions.map((s) => `<article class="card saved-work"><div class="eyebrow">${esc(s.student_name)} · Attempt ${s.attempt}</div><h2>${esc(s.title)}</h2><pre>${esc(s.answer)}</pre><form data-review="${s.id}"><div class="field"><label>Feedback<textarea name="message" required placeholder="Give specific, constructive feedback against the exercise criteria."></textarea></label></div><div class="actions"><label>Decision<select name="decision"><option value="completed">Approve completion</option><option value="needs_revision">Request revision</option></select></label><button type="submit">Send feedback</button></div></form></article>`).join("") || empty("All caught up", "New submissions from assigned students will appear here.")}`,
    "staff",
  );
  document.querySelectorAll("[data-review]").forEach(
    (form) =>
      (form.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api(
            `/staff/submissions/${form.dataset.review}/review`,
            "POST",
            Object.fromEntries(new FormData(form)),
          );
          toast("Feedback recorded");
          await staff();
        } catch (error) {
          toast(error.message);
        }
      }),
  );
  document.querySelectorAll("[data-suspend]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api(
            b.textContent === "Restore access"
              ? "/admin/enrollments"
              : "/admin/suspend",
            "POST",
            { student_id: b.dataset.suspend, course_id: b.dataset.course },
          );
          toast("Enrollment updated");
          await staff();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}
async function admin() {
  const c = await api("/admin/catalog"),
    options = (rows) =>
      rows
        .map(
          (r) => `<option value="${r.id}">${esc(r.title || r.name)}</option>`,
        )
        .join("");
  shell(
    `<div class="intro"><div><div class="eyebrow">Administration</div><h1>Course management</h1><p>Prepare content, publish reviewed lessons, and assign personal learning paths.</p></div></div><div class="notice">Existing enrollments keep their content versions. “Assign / append” adds newly published units to the end of a student’s path without resetting completed work.</div><div class="columns"><section><div class="card"><h2>Assign a learning path</h2><form id="enroll-form"><div class="field"><label>Student<select name="student_id" required>${options(c.students)}</select></label></div><div class="field"><label>Course<select name="course_id" required>${options(c.courses)}</select></label></div><button>Assign / append published lessons</button></form></div><div class="card"><h2>Create course structure</h2><form id="hierarchy-form"><div class="field"><label>Level<select name="type" id="hierarchy-type"><option value="courses">Course</option><option value="weeks">Week</option><option value="days">Day</option><option value="chapters">Chapter</option></select></label></div><div class="field"><label>Parent<select name="parent_id" id="hierarchy-parent"></select></label></div><div class="field"><label>Title<input name="title" required maxlength="200"></label></div><button>Create</button></form></div><div class="card"><h2>Write a learning unit</h2><form id="unit-form"><input type="hidden" name="id"><div class="field"><label>Chapter<select name="chapter_id" required>${options(c.chapters)}</select></label></div><div class="field"><label>Type<select name="kind"><option value="exercise">Exercise</option><option value="reflection">Reflection</option><option value="feedback">Feedback</option><option value="video">Video (media import required)</option></select></label></div><div class="field"><label>Title<input name="title" required maxlength="200"></label></div><div class="field"><label>Reviewed instructions, lesson content, and success criteria<textarea name="content" required rows="9"></textarea></label></div><div class="field"><label>Completion policy<select name="requires_review"><option value="true">Instructor approval required</option><option value="false">Submission completes exercise</option></select></label></div><button>Save draft</button></form></div><div class="card"><h2>Assign a reviewer</h2><form id="assignment-form"><div class="field"><label>Staff<select name="staff_id" required>${options(c.staff)}</select></label></div><div class="field"><label>Student<select name="student_id" required>${options(c.students)}</select></label></div><div class="field"><label>Course<select name="course_id" required>${options(c.courses)}</select></label></div><button>Grant course-scoped access</button></form></div></section><aside><div class="card"><h2>Curriculum library</h2>${c.courses.map((course) => `<div class="row"><div><strong>${esc(course.title)}</strong><p>${course.published ? "Published content available" : "Draft course"}</p></div></div>`).join("") || empty("No courses yet", "Create your first course on the left.")}</div><div class="card"><h2>Learning units</h2>${c.units.map((u) => `<div class="row"><div><strong>${esc(u.title)}</strong><p>${esc(u.kind)} · ${u.published ? "Published" : "Draft"}</p></div><div class="actions"><button class="secondary small" data-edit-unit="${u.id}">Edit</button>${u.media_id ? `<a class="button secondary small" href="/api/files/${u.media_id}" target="_blank" rel="noopener">Preview video</a>` : ""}${!u.published ? `<button class="secondary small" data-publish="${u.id}">Publish</button>` : ""}</div></div>`).join("") || empty("Start with a lesson", "Add a chapter, then create a learning unit.")}</div></aside></div>`,
    "admin",
  );
  const parent = document.querySelector("#hierarchy-parent");
  document.querySelector("#hierarchy-type").onchange = (e) => {
    parent.innerHTML = options(
      c[
        { weeks: "courses", days: "weeks", chapters: "days" }[e.target.value]
      ] || [],
    );
  };
  const bind = (selector, path, transform = (x) => x) =>
    (document.querySelector(selector).onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(
          path,
          "POST",
          transform(Object.fromEntries(new FormData(e.target))),
        );
        toast("Saved");
        await admin();
      } catch (error) {
        toast(error.message);
      }
    });
  bind("#enroll-form", "/admin/enrollments");
  bind("#hierarchy-form", "/admin/hierarchy");
  bind("#assignment-form", "/admin/assignments");
  bind("#unit-form", "/admin/units", (b) => ({
    ...b,
    requires_review: b.requires_review === "true",
  }));
  document.querySelectorAll("[data-edit-unit]").forEach(
    (b) =>
      (b.onclick = () => {
        const u = c.units.find((u) => u.id === b.dataset.editUnit),
          form = document.querySelector("#unit-form");
        for (const key of ["id", "chapter_id", "kind", "title", "content"])
          form.elements[key].value = u[key];
        form.elements.requires_review.value = String(
          Boolean(u.requires_review),
        );
        form.scrollIntoView({ block: "start", behavior: "smooth" });
        toast(
          "Save creates a new draft version; existing students retain their assigned version.",
        );
      }),
  );
  document.querySelectorAll("[data-publish]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api("/admin/publish", "POST", { unit_id: b.dataset.publish });
          toast(
            "Unit published. Assign / append it to student paths when ready.",
          );
          await admin();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}
async function render() {
  const generation = ++renderId;
  cleanup();
  const [route, arg, arg2] = location.hash.slice(1).split("/");
  try {
    if (!me) {
      try {
        me = await api("/me");
      } catch (e) {
        if (e.status !== 401) throw e;
      }
    }
    if (generation !== renderId) return;
    if (!me) {
      auth(route === "register");
      return;
    }
    if (me.role !== "student") {
      if (route === "admin" && me.role === "admin") await admin();
      else if (route === "student") {
        const d = await api(`/staff/students/${arg}/courses/${arg2}`);
        shell(
          `<a href="#staff">← Assigned students</a>${overview(d, true)}`,
          "staff",
        );
      } else await staff();
      return;
    }
    if (route === "lesson") await lesson(arg);
    else if (route === "work") await work();
    else if (route === "history") {
      const h = await api(
        `/history${arg ? "?cursor=" + encodeURIComponent(arg) : ""}`,
      );
      shell(
        `<div class="eyebrow">Your journey, remembered</div><h1>Learning history</h1><div class="card">${history(h.items, 50)}</div>${h.next ? `<a class="button secondary" href="#history/${h.next}">Older activity →</a>` : ""}<a class="button secondary" href="#dashboard">Back to My GLITCH</a>`,
      );
    } else {
      dashboard = await api("/dashboard");
      if (route === "roadmap") roadmap(dashboard, arg);
      else shell(overview(dashboard));
    }
  } catch (e) {
    if (e.status === 401) {
      me = null;
      auth();
      return;
    }
    shell(
      `<h1>Unable to open this view</h1><p class="error">${esc(e.message)}</p><a class="button" href="#dashboard">Return to workspace</a>`,
    );
  }
}
window.addEventListener("hashchange", render);
render();
