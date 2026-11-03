# iLearn

A local-first personal learning dashboard with topic PDF reading and Gemini-powered lessons and practice. Node.js 18 or newer is required.

```sh
npm install
npm start
```

Open `http://localhost:8000`, create an account, then sign in. The server binds to localhost by default. Accounts are stored in the server's ignored `data/accounts.json`; passwords are salted and hashed with scrypt. Sessions are held in server memory, expire after 12 hours and end on server restart. There is no email verification or password recovery. Use HTTPS for remote access; `TRUST_PROXY=1` is only for a trusted TLS-terminating proxy.

Learning records and PDFs remain in browser storage, scoped by account for convenience but **not encrypted or protected from others with access to the same browser**. They do not sync across devices. Clearing browser data removes them. The JSON export in Settings does **not** contain PDF files and there is no import/restore feature. Keep your original PDFs. Do not store sensitive information in this prototype. To copy a workspace created before sign-in was added, use **Settings → Copy previous browser workspace** on the same browser; it only works if the account has no existing local records.

## Learn within a topic

1. Add a subject and a topic, then select **Open topic**.
2. Upload one or more PDFs (up to 15 MB and 500 pages per file), or generate a step-by-step lesson. A topic can have both. Choose the PDF you want in the topic, or select one in the lesson or practice generator. The selected learning path determines its displayed progress; switch paths with **Use for progress**.
3. PDF progress is the percentage of unique pages successfully displayed in the reader. It is a page-view measure, **not proof that the text was read or understood**. Each PDF keeps its own page-view progress; the selected PDF determines topic progress when the PDF path is active.
4. Lesson progress is the percentage of lesson checks answered correctly. Each check submission is stored as an assessment attempt, including incorrect attempts. Questions remain in the shared question bank.
5. Select **Generate practice questions** in the topic. To use the PDF, choose **Use text from this topic's PDF**, review the extracted text, then generate. You can also choose a PDF as the source when generating a lesson.

Selectable PDF text is extracted in the browser. Pages with little or no selectable text use local English OCR (Tesseract.js); OCR may take time and can make mistakes, especially with handwriting, poor scans, formulas, or non-English text. Extraction stops after at most 5 scanned pages or 12,000 characters, whichever comes first; the app tells you if only part of the document was processed. Review and edit the extracted text before sending it to Gemini. If OCR cannot recognize the material, paste the text manually. The PDF itself remains in the browser. The subject, topic and reviewed source text are sent to Gemini when you request generation. Check generated content against trusted materials; AI-generated lessons and questions are not verified official examination material.

## Gemini setup

Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey), then set it **on the server**, not in the browser or repository:

```sh
export GEMINI_API_KEY="your-key-here"
npm start
```

On Windows PowerShell, use `$env:GEMINI_API_KEY = "your-key-here"` before running `npm start`. The optional `GEMINI_MODEL` environment variable overrides the default `gemini-2.5-flash`. Use a model that supports structured JSON output and is enabled for your key. Restart the server after changing environment variables. Avoid sharing your key in chat or committing it to Git. Manual questions and PDF reading work without Gemini.

The server validates request fields and generated output, uses a basic in-memory per-IP rate limit, and does not expose the API key to the frontend. It cannot guarantee academic correctness or detect every ambiguous answer. The generation endpoints require a signed-in session, but this single-process authentication and browser-local storage are not production-grade; **do not expose this prototype or a configured key-backed server publicly**. Production deployment needs authentication, authorization, durable shared rate limits, secure transport, monitoring and other protections. For local use, rate limits are per server instance and reset on restart; the hosted database shares account and generation rate limits across instances.


## Vercel deployment

The `simplelearn` Vercel project needs a dedicated Turso (libSQL) database. Connect it through Vercel's storage/marketplace integration and set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for the production environment. The server creates its account, session and rate-limit tables on first use. Never put these values in the repository or chat. Add `GEMINI_API_KEY` as a sensitive production environment variable in Vercel to enable AI generation; without it the manual features still work. Redeploy after changing environment variables.

The Vercel build (`npm run build`) creates `public/` with the client, PDF reader, and local OCR assets. API routes run through `api/[...path].js`. When `VERCEL` is set and the database is missing, authentication fails closed instead of using ephemeral files. Accounts and sessions are stored in the hosted database, but learning records and PDFs are still browser-local and do not sync across devices. Local-server accounts are separate from hosted accounts. Do not publish or use this prototype for sensitive data without production-grade security review, email verification, password recovery and secure server-side data storage.

## Included

- Subjects and topics with shared references, PDF reading, guided lessons and derived progress.
- Resource links, personal notes, study sessions and manually completed goals.
- Student-created and Gemini-generated objective questions, untimed practice, automatic scoring, attempt review and derived analytics.
- Flashcards with simple response-based review intervals and references to incorrect practice answers.
- Overview derived from saved records, activity chart and in-app upcoming reminders.
- Responsive navigation, profile settings, validation, duplicate checks and deletion safeguards for linked records.

Run tests with `npm test`. Gemini responses, browser PDF rendering, and browser OCR are mocked in the tests; no API key is required.

## Scope and limitations

This is a functional foundation, **not a production implementation of the full specification**. There is no email verification, password recovery, secure server-side storage or access control for learning records, official question bank, timed testing, rich-text editor, push/email notifications, or production-grade server security. Reminders appear only while using the app. Resource links are not cached offline. Notes are plain text. Goals are manually marked complete. Dates and times use the browser's local timezone. Analytics are based only on submitted local attempts; they are not mastery estimates. A production system needs a secured backend, durable database, access controls and proper testing before handling real student data.
