/* ==========================================================================
   QUIZ FUNNEL — script.js
   Plain JS. No frameworks, no build step.

   Sections:
   1. Config (fill these in before going live)
   2. State + DOM refs
   3. Navigation (render step, select answer, next/back)
   4. GTM step tracking
   5. Final submit -> Meta Pixel Lead + Klaviyo (profile, subscribe, event) -> redirect
   ========================================================================== */

/* ---------------------- 1. CONFIG -------------------------------------- */
const CONFIG = {
  // Klaviyo public "Site ID" / company_id (safe to expose client-side).
  // Found in Klaviyo: Settings > API Keys > Public API Key
  KLAVIYO_COMPANY_ID: "YOUR_KLAVIYO_PUBLIC_KEY",

  // The Klaviyo List ID this quiz should subscribe people to.
  // Found in Klaviyo: Lists & Segments > [list] > Settings
  KLAVIYO_LIST_ID: "YOUR_KLAVIYO_LIST_ID",

  // Klaviyo client API revision date (see klaviyo docs, keep current)
  KLAVIYO_REVISION: "2024-10-15",

  // Where the final button sends the person
  REDIRECT_URL: "https://ledisa.com/products/glp-1",
};

/* ---------------------- 2. STATE + DOM REFS ----------------------------- */
const TOTAL_STEPS = 9; // 8 questions + 1 contact step

const state = {
  currentStep: 1,
  answers: {}, // { goal: "Lose weight", journey: "...", ... }
};

const quizForm = document.getElementById("quizForm");
const steps = Array.from(document.querySelectorAll(".step"));
const progressFill = document.getElementById("progressFill");
const stepLabel = document.getElementById("stepLabel");
const backBtn = document.getElementById("backBtn");
const nextBtn = document.getElementById("nextBtn");
const navRow = document.getElementById("navRow");
const submitBtn = document.getElementById("submitBtn");
const formError = document.getElementById("formError");

/* ---------------------- 3. NAVIGATION ----------------------------------- */

function renderStep() {
  steps.forEach((s) => {
    const isActive = Number(s.dataset.step) === state.currentStep;
    s.dataset.active = isActive ? "true" : "false";
  });

  // Progress bar (contact step counts as the 9th of 9 total)
  const pct = (state.currentStep / TOTAL_STEPS) * 100;
  progressFill.style.width = pct + "%";

  const isContactStep = state.currentStep === TOTAL_STEPS;
  stepLabel.textContent = isContactStep
    ? "Last step"
    : `Step ${state.currentStep} of ${TOTAL_STEPS - 1}`;

  backBtn.classList.toggle("visible", state.currentStep > 1);

  // Hide the shared Next/Back nav row on the contact step; it has its own submit button
  navRow.style.display = isContactStep ? "none" : "flex";

  updateNextButtonState();

  // Fire the GTM step event every time a step is shown
  trackStepView(state.currentStep);
}

function currentQuestionKey() {
  const step = steps.find((s) => Number(s.dataset.step) === state.currentStep);
  const optionsWrap = step ? step.querySelector(".options") : null;
  return optionsWrap ? optionsWrap.dataset.question : null;
}

function updateNextButtonState() {
  const key = currentQuestionKey();
  if (!key) return; // contact step has no Next button state to manage
  nextBtn.disabled = !state.answers[key];
}

// Handle option selection (event delegation)
quizForm.addEventListener("click", (e) => {
  const btn = e.target.closest(".option");
  if (!btn) return;

  const step = btn.closest(".step");
  const optionsWrap = btn.closest(".options");
  const questionKey = optionsWrap.dataset.question;

  // Clear previous selection in this step
  optionsWrap.querySelectorAll(".option").forEach((o) => o.classList.remove("selected"));
  btn.classList.add("selected");

  state.answers[questionKey] = btn.dataset.value;
  updateNextButtonState();
});

nextBtn.addEventListener("click", () => {
  if (state.currentStep < TOTAL_STEPS) {
    state.currentStep += 1;
    renderStep();
  }
});

backBtn.addEventListener("click", () => {
  if (state.currentStep > 1) {
    state.currentStep -= 1;
    renderStep();
  }
});

/* ---------------------- 4. GTM STEP TRACKING ---------------------------- */

window.dataLayer = window.dataLayer || [];

function trackStepView(stepNumber) {
  // Contact step is step 9 -> label it "quiz_step_contact" for clarity in GTM/GA
  const eventName =
    stepNumber === TOTAL_STEPS ? "quiz_step_contact" : `quiz_step_${stepNumber}`;

  window.dataLayer.push({
    event: eventName,
    quiz_step_number: stepNumber,
    quiz_answers_so_far: { ...state.answers },
  });
}

/* ---------------------- 5. FINAL SUBMIT --------------------------------- */

quizForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const firstName = document.getElementById("firstName").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();

  const validationError = validateContact(firstName, email, phone);
  if (validationError) {
    formError.textContent = validationError;
    return;
  }
  formError.textContent = "";

  submitBtn.disabled = true;
  submitBtn.querySelector(".btn-text").textContent = "Sending...";

  const contact = { firstName, email, phone };

  try {
    // Fire tracking + CRM calls in parallel; don't let a slow/failed
    // Klaviyo call block the person from reaching their result page.
    await Promise.allSettled([
      trackMetaLead(contact, state.answers),
      sendToKlaviyo(contact, state.answers),
    ]);
  } finally {
    window.location.href = CONFIG.REDIRECT_URL;
  }
});

function validateContact(firstName, email, phone) {
  if (!firstName) return "Please enter your first name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email.";
  if (!/^[0-9+()\-.\s]{7,}$/.test(phone)) return "Please enter a valid phone number.";
  return null;
}

/* ---- Meta (Facebook) Pixel: Lead event on final submission ---- */
function trackMetaLead(contact, answers) {
  return new Promise((resolve) => {
    if (typeof fbq !== "function") {
      resolve();
      return;
    }
    fbq(
      "track",
      "Lead",
      {
        content_name: "GLP-1 Quiz",
        quiz_goal: answers.goal,
        quiz_weight_goal: answers.weight_goal,
        quiz_age_range: answers.age_range,
        quiz_glp1_experience: answers.glp1_experience,
        quiz_start_timing: answers.start_timing,
      },
      { eventID: `quiz_lead_${Date.now()}` } // helps with Conversions API de-duplication if added later
    );
    // fbq is fire-and-forget; resolve immediately after queuing
    resolve();
  });
}

/* ---- Klaviyo: create/update profile, subscribe to list, track event ---- */
async function sendToKlaviyo(contact, answers) {
  const base = "https://a.klaviyo.com/client";
  const query = `?company_id=${encodeURIComponent(ULp6Yk)}`;
  const headers = {
    "Content-Type": "application/json",
    revision: CONFIG.KLAVIYO_REVISION,
  };

  const profileAttributes = {
    email: contact.email,
    first_name: contact.firstName,
    phone_number: contact.phone,
    properties: {
      quiz_goal: answers.goal,
      quiz_journey: answers.journey,
      quiz_weight_goal: answers.weight_goal,
      quiz_age_range: answers.age_range,
      quiz_conditions: answers.conditions,
      quiz_glp1_experience: answers.glp1_experience,
      quiz_motivation: answers.motivation,
      quiz_start_timing: answers.start_timing,
      quiz_completed_at: new Date().toISOString(),
    },
  };

  // 1) Create/update the profile with quiz answers as custom properties
  const profileCall = fetch(`${base}/profiles/${query}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        type: "profile",
        attributes: profileAttributes,
      },
    }),
  });

  // 2) Subscribe the profile to the target list (email + SMS marketing consent)
  const subscribeCall = fetch(`${base}/subscriptions/${query}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        type: "subscription",
        attributes: {
          profile: {
            data: {
              type: "profile",
              attributes: {
                email: contact.email,
                phone_number: contact.phone,
                subscriptions: {
                  email: { marketing: { consent: "SUBSCRIBED" } },
                  sms: { marketing: { consent: "SUBSCRIBED" } },
                },
              },
            },
          },
        },
        relationships: {
          list: {
            data: { type: "list", id: VWwrNY },
          },
        },
      },
    }),
  });

  // 3) Track a "Completed Quiz" event on the profile with the full answer set
  const eventCall = fetch(`${base}/events/${query}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        type: "event",
        attributes: {
          properties: { ...answers },
          metric: {
            data: {
              type: "metric",
              attributes: { name: "Completed Quiz" },
            },
          },
          profile: {
            data: {
              type: "profile",
              attributes: {
                email: contact.email,
                first_name: contact.firstName,
                phone_number: contact.phone,
              },
            },
          },
        },
      },
    }),
  });

  return Promise.allSettled([profileCall, subscribeCall, eventCall]);
}

/* ---------------------- INIT -------------------------------------------- */
renderStep();
