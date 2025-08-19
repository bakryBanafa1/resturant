# استخدم صورة Node.js
FROM node:18

# أنشئ مجلد العمل داخل الحاوية
WORKDIR /usr/src/app

# انسخ package.json أولاً ونفذ npm install
COPY package.json ./
RUN npm install --production

# انسخ باقي ملفات المشروع
COPY . .
RUN mkdir -p /usr/src/app/newstartDB
# افتح بورت 3000 (غيره إذا مشروعك يستخدم بورت ثاني)
EXPOSE 3000

# شغل التطبيق
CMD ["node", "index.js"]
