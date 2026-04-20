# Full-Stack Engineering Challenge: DentalScan AI

## 🦷 Introduction
Welcome! At **DentalScan**, we are revolutionizing oral healthcare using cutting-edge AI. This challenge is designed to see how you handle a real-world, full-stack environment. You will be working on improving our core product: the AI-powered dental scanning flow and the surrounding ecosystem.

---

## 🚀 The Journey

### Phase 1: Explore & Audit (1 Hour)
Before writing any code, we want you to experience the product as a user.
1. **Visit the Main Site**: [https://www.dentalscan.us/](https://www.dentalscan.us/)
2. **Perform a Discovery Scan**: Navigate through the demo and perform a full 5-angle scan (Front, Left, Right, Upper, Lower).
3. **The Task**: Write a brief technical and UX audit (max 300 words). What could be smoother? What technical challenges do you foresee with mobile camera stability?
4. **Deliverable**: Save this as `AUDIT.md` in your submission.

---

### Phase 2: Implementation (3-5 Hours)
In this phase, you will work on the provided **Starter Kit** repository. We have three core areas of focus:

#### 1. Scan Enhancement (Frontend)
The "Capture Flow" is the most critical part of our app. High-quality images mean high-quality AI results.
* **The Problem**: Patients often hold their phones too far or too close.
* **The Task**: Implement a **Visual Guidance Circle** or "Mouth Guide" overlay in the camera view.
* **Requirements**:
    - The guide should be responsive and centered.
    - Add a "Quality Indicator" (e.g., color changes when the user is stable).
* **Focus**: React performance (media feed overhead) and UI polish.

#### 2. Notification System (Backend & State)
Clinics need to be alerted when a scan is uploaded so they can join the Telehealth room.
* **The Task**: Build a "Scan Completed" notification trigger.
* **Requirements**:
    - Update the scan submission logic to trigger a simulated notification.
    - Implement a storage mechanism (Prisma `Notification` model) to track read/unread states.
* **Focus**: API design, database integrity, and asynchronous flow logic.

#### 3. Patient-Dentist Messaging (Full-Stack)
Post-scan communication is key to conversion.
* **The Task**: Add a simple **Quick-Message Sidebar** to the scan result dashboard.
* **Requirements**:
    - A UI to send a message to the clinic.
    - A backend route to persist this message in the `Thread` / `Message` database.
* **Focus**: Full-stack integration and state consistency.

---

## 🛠 Technical Stack
* **Frontend**: Next.js 14 (App Router), Tailwind CSS.
* **Backend**: Next.js API Routes, Prisma ORM.
* **Infrastructure**: PostgreSQL, Twilio/Telnyx (Stubs).

---

## 📝 Submission Guidelines
1. **Fork/Clone**: Start from our official boilerplate.
2. **Implement**: Complete the tasks listed above.
3. **Record**: A mandatory **2-minute Loom video** explaining your architectural decisions and demoing your results.
4. **Submit**: Send your Repository Link and Loom Video to [EMAIL_ADDRESS]`.

---

## 🎯 Evaluation Criteria
- **UX Intuition**: Is the scanning guide actually helpful?
- **Code Quality**: Is your code modular, readable, and typed?
- **Product Thinking**: Did your `AUDIT.md` show deep curiosity about the problem?
- **Communication**: Was your Loom video clear and professional?

---

**Good luck! We can't wait to see what you build.**
