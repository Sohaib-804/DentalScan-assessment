# 🚀 Candidate Setup Guide

Welcome! This guide will help you get your local development environment ready for the DentalScan AI Engineering Challenge.

## Quick Start

Follow these steps to get the project running in under 2 minutes:

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Initialize Database**:
    This project uses **SQLite** for ease of setup. Run the following command to create your local database and sync the schema:
    ```bash
    npx prisma db push
    ```

3.  **Run the Development Server**:
    ```bash
    npm run dev
    ```

4.  **Open the App**:
    Navigate to [http://localhost:3000](http://localhost:3000) to see the Scanning Flow in action.

## Project Notes

-   **Database**: The database is located at `prisma/dev.db`. You can explore it using `npx prisma studio`.
-   **Framework**: Built with Next.js 14 (App Router) and Tailwind CSS.
-   **Structure**:
    -   `src/components/ScanningFlow.tsx`: The core capture component (Task 1).
    -   `src/app/api/notify/route.ts`: Notification logic (Task 2).
    -   `src/app/api/messaging/route.ts`: Messaging logic (Task 3).

## 🦷 Good Luck!
We're excited to see your implementation. If you have any questions, feel free to reach out.
