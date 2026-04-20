# DentalScan AI - Engineering Challenge Starter Kit

Welcome to the DentalScan Engineering Challenge! This repository is a "lite" version of our production environment. Your goal is to enhance this codebase according to the requirements in the [Assignment PDF](../docs/assignment.md).

## 🚀 Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Setup Database**:
   ```bash
   npx prisma generate
   ```
3. **Run Development Server**:
   ```bash
   npm run dev
   ```

## 🦷 The Tasks

### 1. Discovery (Explore First)
Visit [https://www.dentalscan.us/](https://www.dentalscan.us/) to understand the core product. Experience how we take different angles of images and how they are processed.

### 2. Frontend: Scan Enhancement
Improve `src/components/ScanningFlow.tsx`. 
- **Goal**: Implement a "Mouth Guide" overlay that helps users center their face correctly.
- **Bonus**: Add real-time visual feedback based on the simulated `guardrail` state.

### 3. Backend: Notifications
Work on `src/app/api/notify/route.ts`.
- **Goal**: Implement a trigger that records a `Notification` in the database when a scan is finalized.

### 4. Full-Stack: Messaging
Implement a messaging sidebar on the result page.
- **Goal**: Allow clinicians and patients to communicate.
- **Models**: See `prisma/schema.prisma` for `Thread` and `Message`.

## 📝 Submission
- Ensure your code is clean and modular.
- Include a 2-minute Loom video demoing your changes.
- Email your repo link to `rachana@dentalscan.us`.

**Happy Coding!**
