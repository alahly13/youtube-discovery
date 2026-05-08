# دليل Git و GitHub بالعربي — Pull / Push / تبديل الحسابات

هذا الدليل مخصص لإدارة مشاريع GitHub بسهولة، خصوصًا عند التعامل مع أكثر من حساب مثل:

- `alahly13`
- `MahdyHQ`

ومع الريبو:

```text
https://github.com/alahly13/dailymotion-video-discovery.git
```

> ملاحظة مهمة: لا تضع أي Password أو Token داخل الكود أو داخل ملفات المشروع. استخدم Secrets أو GitHub CLI أو SSH keys.

---

## 1. مفاهيم سريعة

### ما هو Git؟

Git هو نظام إدارة نسخ الكود. يسمح لك بحفظ التغييرات، الرجوع للإصدارات القديمة، إنشاء branches، ورفع الكود على GitHub.

### ما هو GitHub؟

GitHub هو منصة استضافة repositories. أنت ترفع عليها مشروعك باستخدام Git.

### أهم كلمات

| المصطلح | المعنى |
|---|---|
| Repository / Repo | المشروع المخزن على GitHub |
| Clone | تنزيل نسخة من الريبو على جهازك أو بيئة العمل |
| Pull | سحب آخر تحديثات من GitHub |
| Push | رفع تغييراتك إلى GitHub |
| Commit | حفظ تغييراتك محليًا داخل Git |
| Branch | فرع تطوير منفصل |
| Remote | رابط الريبو على GitHub |
| Origin | اسم افتراضي للـ remote الرئيسي |
| Main | الفرع الرئيسي غالبًا |

---

## 2. فحص حالة المشروع

داخل فولدر المشروع نفّذ:

```bash
git status
```

يعرض لك الملفات المعدلة والجديدة وهل هناك تغييرات جاهزة للرفع.

---

## 3. معرفة الفرع الحالي

```bash
git branch
```

أو:

```bash
git branch --show-current
```

---

## 4. معرفة رابط GitHub المتصل بالمشروع

```bash
git remote -v
```

مثال:

```text
origin  https://github.com/alahly13/dailymotion-video-discovery.git (fetch)
origin  https://github.com/alahly13/dailymotion-video-discovery.git (push)
```

---

## 5. ربط المشروع بريبو GitHub

لو المشروع موجود عندك لكن غير مربوط بـ GitHub:

```bash
git remote add origin https://github.com/alahly13/dailymotion-video-discovery.git
```

لو الرابط موجود وتريد تغييره:

```bash
git remote set-url origin https://github.com/alahly13/dailymotion-video-discovery.git
```

تأكد:

```bash
git remote -v
```

---

## 6. تنزيل الريبو من GitHub

```bash
git clone https://github.com/alahly13/dailymotion-video-discovery.git
cd dailymotion-video-discovery
```

---

## 7. Pull — سحب آخر التحديثات

```bash
git pull origin main
```

لو الفرع اسمه `master`:

```bash
git pull origin master
```

لو أنت على نفس الفرع ومضبوط upstream:

```bash
git pull
```

---

## 8. Add / Commit / Push — رفع تغييراتك

### عرض الملفات المتغيرة

```bash
git status
```

### إضافة كل الملفات

```bash
git add .
```

أو ملف معين:

```bash
git add src/app/page.tsx
```

### عمل commit

```bash
git commit -m "Update project files"
```

مثال أفضل:

```bash
git commit -m "Improve Channel Explorer filtering and UI"
```

### رفع التغييرات

```bash
git push origin main
```

لو أول مرة ترفع الفرع:

```bash
git push -u origin main
```

---

## 9. أمر سريع للرفع اليومي

```bash
git status
git pull origin main
git add .
git commit -m "Describe your changes"
git push origin main
```

---

## 10. لو ظهر conflict أثناء pull

افتح الملفات المتعارضة وستجد علامات مثل:

```text
<<<<<<< HEAD
الكود عندك
=======
الكود القادم من GitHub
>>>>>>> origin/main
```

عدّل الملف يدويًا، ثم:

```bash
git add .
git commit -m "Resolve merge conflicts"
git push origin main
```

---

## 11. إعداد اسم وإيميل Git

### إعداد عالمي لكل المشاريع

```bash
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"
```

### إعداد خاص بمشروع واحد فقط

داخل المشروع:

```bash
git config user.name "alahly13"
git config user.email "your-alahly13-email@example.com"
```

تأكد:

```bash
git config user.name
git config user.email
```

عرض كل الإعدادات:

```bash
git config --list
```

---

## 12. مهم: اسم Git ليس هو تسجيل الدخول

الأوامر دي تحدد اسم صاحب الـ commit فقط:

```bash
git config user.name
git config user.email
```

لكن تسجيل الدخول الحقيقي إلى GitHub يتم عن طريق:

- HTTPS + Personal Access Token
- SSH Key
- GitHub CLI

---

# الجزء الثاني: التعامل مع أكثر من حساب GitHub

عندك مثلًا حسابين:

```text
alahly13
MahdyHQ
```

أفضل طريقة احترافية للتبديل بين حسابات متعددة هي **SSH keys منفصلة**.

---

## 13. الطريقة الأولى: HTTPS

رابط الريبو الحالي:

```text
https://github.com/alahly13/dailymotion-video-discovery.git
```

ربطه:

```bash
git remote set-url origin https://github.com/alahly13/dailymotion-video-discovery.git
```

عند push، GitHub قد يطلب تسجيل دخول أو token.

### ملاحظات

- لا تستخدم password عادي.
- استخدم Personal Access Token إذا احتاج GitHub ذلك.
- لا تضع token داخل remote URL.
- لا تحفظ token داخل ملفات المشروع.

---

## 14. حذف بيانات تسجيل دخول GitHub المخزنة

لو Git يرفع بحساب غلط، امسح بيانات الاعتماد.

### على Windows

```text
Credential Manager
→ Windows Credentials
→ github.com
→ Remove
```

ثم جرّب push مرة ثانية.

---

## 15. الطريقة الثانية: SSH — الأفضل للحسابات المتعددة

كل حساب GitHub يكون له SSH key منفصل.

---

## 16. إنشاء SSH key لحساب alahly13

```bash
ssh-keygen -t ed25519 -C "alahly13" -f ~/.ssh/id_ed25519_alahly13
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519_alahly13
cat ~/.ssh/id_ed25519_alahly13.pub
```

انسخ الناتج وأضفه في GitHub:

```text
GitHub alahly13
→ Settings
→ SSH and GPG keys
→ New SSH key
```

---

## 17. إنشاء SSH key لحساب MahdyHQ

```bash
ssh-keygen -t ed25519 -C "MahdyHQ" -f ~/.ssh/id_ed25519_MahdyHQ
ssh-add ~/.ssh/id_ed25519_MahdyHQ
cat ~/.ssh/id_ed25519_MahdyHQ.pub
```

انسخ الناتج وأضفه في حساب GitHub الخاص بـ `MahdyHQ`.

---

## 18. إعداد ملف SSH config للحسابات المتعددة

افتح أو أنشئ الملف:

```bash
nano ~/.ssh/config
```

أضف:

```sshconfig
Host github-alahly13
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_alahly13
  IdentitiesOnly yes

Host github-MahdyHQ
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_MahdyHQ
  IdentitiesOnly yes
```

---

## 19. اختبار SSH لكل حساب

```bash
ssh -T git@github-alahly13
ssh -T git@github-MahdyHQ
```

لو نجح، ستظهر رسالة ترحيب باسم الحساب.

---

## 20. استخدام SSH remote لحساب alahly13

```bash
git remote set-url origin git@github-alahly13:alahly13/dailymotion-video-discovery.git
git remote -v
git push origin main
```

---

## 21. استخدام SSH remote لحساب MahdyHQ

لو الريبو على `MahdyHQ`:

```bash
git remote set-url origin git@github-MahdyHQ:MahdyHQ/dailymotion-video-discovery.git
git push origin main
```

---

## 22. الاحتفاظ بريموتين: alahly13 و MahdyHQ

```bash
git remote rename origin alahly13
git remote add mahdyhq git@github-MahdyHQ:MahdyHQ/dailymotion-video-discovery.git
git remote -v
```

السحب من `alahly13`:

```bash
git pull alahly13 main
```

الرفع إلى `MahdyHQ`:

```bash
git push mahdyhq main
```

الرفع إلى الاثنين:

```bash
git push alahly13 main
git push mahdyhq main
```

---

# الجزء الثالث: GitHub CLI

GitHub CLI اسمه `gh`.

## 23. تسجيل الدخول

```bash
gh auth login
```

اختر:

```text
GitHub.com
HTTPS أو SSH
Login with browser
```

## 24. معرفة الحساب الحالي

```bash
gh auth status
```

## 25. الخروج من الحساب

```bash
gh auth logout
```

## 26. تسجيل الدخول بحساب آخر

```bash
gh auth logout
gh auth login
```

---

## 27. إنشاء repo جديد من التيرمنال

Private:

```bash
gh repo create dailymotion-video-discovery --private --source=. --remote=origin --push
```

Public:

```bash
gh repo create dailymotion-video-discovery --public --source=. --remote=origin --push
```

---

# الجزء الرابع: Branches

## 28. إنشاء branch جديد

```bash
git switch -c feature/new-design
```

أو:

```bash
git checkout -b feature/new-design
```

## 29. التبديل بين branches

```bash
git switch main
git switch feature/new-design
```

## 30. رفع branch جديد

```bash
git push -u origin feature/new-design
```

## 31. حذف branch محلي

```bash
git branch -d feature/new-design
```

إجباريًا:

```bash
git branch -D feature/new-design
```

## 32. حذف branch من GitHub

```bash
git push origin --delete feature/new-design
```

---

# الجزء الخامس: أوامر الطوارئ

## 33. إلغاء تعديل ملف قبل commit

```bash
git restore path/to/file
```

إلغاء كل التعديلات:

```bash
git restore .
```

## 34. إزالة ملف من staging

```bash
git restore --staged path/to/file
```

أو:

```bash
git restore --staged .
```

## 35. تعديل آخر commit message

```bash
git commit --amend -m "New commit message"
```

## 36. الرجوع لآخر نسخة من GitHub

تحذير: هذا يمسح التعديلات المحلية غير المحفوظة.

```bash
git fetch origin
git reset --hard origin/main
```

## 37. حفظ التغييرات مؤقتًا بدون commit

```bash
git stash
git stash list
git stash pop
```

---

# الجزء السادس: Pull Requests

## 38. إنشاء branch لميزة جديدة

```bash
git switch -c feature/ui-refresh
```

بعد التعديلات:

```bash
git add .
git commit -m "Implement UI refresh"
git push -u origin feature/ui-refresh
```

ثم افتح GitHub واعمل Pull Request.

## 39. تحديث branch بآخر main

```bash
git switch feature/ui-refresh
git pull origin main
```

لو حصل conflict، حلّه ثم:

```bash
git add .
git commit -m "Resolve conflicts with main"
git push
```

---

# الجزء السابع: أوامر خاصة بريبو dailymotion-video-discovery

## 40. ربطه بحساب alahly13 عبر HTTPS

```bash
git remote set-url origin https://github.com/alahly13/dailymotion-video-discovery.git
git remote -v
```

## 41. ربطه بحساب alahly13 عبر SSH

```bash
git remote set-url origin git@github-alahly13:alahly13/dailymotion-video-discovery.git
git remote -v
```

## 42. Pull

```bash
git pull origin main
```

## 43. Push

```bash
git add .
git commit -m "Update platform"
git push origin main
```

## 44. إضافة MahdyHQ كحساب ثاني

```bash
git remote add mahdyhq git@github-MahdyHQ:MahdyHQ/dailymotion-video-discovery.git
git push mahdyhq main
```

---

# الجزء الثامن: Workflow يومي مقترح

## العمل مباشرة على main

```bash
git status
git pull origin main
git add .
git commit -m "Describe the update"
git push origin main
```

## العمل الاحترافي بفرع منفصل

```bash
git switch main
git pull origin main
git switch -c feature/my-update
```

بعد التعديلات:

```bash
git add .
git commit -m "Implement my update"
git push -u origin feature/my-update
```

ثم افتح Pull Request.

---

# الجزء التاسع: مشاكل شائعة وحلولها

## 45. Permission denied publickey

افحص:

```bash
git remote -v
ssh -T git@github-alahly13
ssh -T git@github-MahdyHQ
```

تأكد أن remote يستخدم host الصحيح:

```text
git@github-alahly13:...
```

أو:

```text
git@github-MahdyHQ:...
```

---

## 46. Repository not found

الأسباب المحتملة:

- الريبو غير موجود
- تستخدم حساب غلط
- ليس لديك صلاحية
- remote URL غلط

افحص:

```bash
git remote -v
```

---

## 47. Push rejected

اسحب الأول:

```bash
git pull origin main
git push origin main
```

أو:

```bash
git pull --rebase origin main
git push origin main
```

لو حصل conflict أثناء rebase:

```bash
git add .
git rebase --continue
git push origin main
```

---

## 48. معرفة آخر commits

```bash
git log --oneline -10
```

عرض جميل:

```bash
git log --oneline --graph --decorate --all
```

---

# الجزء العاشر: قواعد أمان مهمة

## لا ترفع هذه الملفات أبدًا

```text
.env
.env.local
.local.env
*.env
```

تأكد أنها في `.gitignore`:

```gitignore
.env
.env.local
.local.env
*.env
```

## أسرار ممنوع رفعها

```text
DATABASE_URL
GEMINI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
GitHub tokens
```

لو رفعت سر بالغلط:

1. احذف الملف من Git.
2. غيّر السر من المنصة الأصلية.
3. لا تعتمد فقط على حذف commit.

---

# الجزء الحادي عشر: أوامر فحص سريعة

```bash
git status
git remote -v
git branch --show-current
git config user.name
git config user.email
gh auth status
ssh -T git@github-alahly13
ssh -T git@github-MahdyHQ
```

---

# ملخص سريع

## Pull

```bash
git pull origin main
```

## Push

```bash
git add .
git commit -m "Update"
git push origin main
```

## تغيير remote إلى alahly13

HTTPS:

```bash
git remote set-url origin https://github.com/alahly13/dailymotion-video-discovery.git
```

SSH:

```bash
git remote set-url origin git@github-alahly13:alahly13/dailymotion-video-discovery.git
```

## إضافة MahdyHQ كحساب ثاني

```bash
git remote add mahdyhq git@github-MahdyHQ:MahdyHQ/dailymotion-video-discovery.git
git push mahdyhq main
```

## أفضل طريقة للحسابات المتعددة

استخدم SSH keys مختلفة وملف:

```text
~/.ssh/config
```

بحسابات منفصلة:

```text
github-alahly13
github-MahdyHQ
```
