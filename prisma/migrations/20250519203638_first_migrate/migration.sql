-- CreateTable
CREATE TABLE "User" (
    "user_id" SERIAL NOT NULL,
    "user_name" TEXT,
    "user_pass" TEXT,
    "user_fname" TEXT,
    "user_lname" TEXT,
    "user_email" TEXT NOT NULL,
    "user_phone" TEXT,
    "user_img" TEXT,
    "user_status" INTEGER NOT NULL,
    "google_id" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_user_name_key" ON "User"("user_name");

-- CreateIndex
CREATE UNIQUE INDEX "User_user_email_key" ON "User"("user_email");

-- CreateIndex
CREATE UNIQUE INDEX "User_google_id_key" ON "User"("google_id");
