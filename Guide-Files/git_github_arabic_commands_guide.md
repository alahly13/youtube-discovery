# الدليل الشامل والمنطقي لأوامر Git و GitHub بالعربي

دليل عملي ومُنظّم بالترتيب المنطقي خطوة بخطوة: يبدأ من **تسجيل الدخول وإدارة الحسابات المتعددة**، مروراً بـ **فحص المستودعات والروابط**، ثم **الفحص والمقارنة**، ثم **أوامر السحب والرفع**، وحل مشكلة **رفض الرفع (Updates were rejected / Pull first)**، وانتهاءً بـ **أوامر الطوارئ والتراجع** والملخص السريع.

> **حسابات العمل المعتادة:**
> - `alahly13`
> - `MahdyHQ`
>
> **ملاحظة أمان هامة:** لا تضع أي Token أو كلمة مرور داخل ملفات الكود أو داخل روابط الـ Git. استخدم أدوات الاعتماد الرسمية مثل **GitHub CLI (`gh`)** أو **مفاتيح SSH**.

---

## فهرس مراحل الدليل (الترتيب المنطقي للعمل)

1. [المرحلة 1: تسجيل الدخول، فحص الحساب الفعّال، والتبديل بين الحسابات](#المرحلة-1-تسجيل-الدخول-وفحص-الحساب-الفعال-والتبديل-بين-الحسابات)
2. [المرحلة 2: فحص المستودعات والروابط (Remotes & Repositories)](#المرحلة-2-فحص-المستودعات-والروابط-remotes--repositories)
3. [المرحلة 3: فحص الحالة والمقارنة والفروع (Status, Diff & Branches)](#المرحلة-3-فحص-الحالة-والمقارنة-والفروع)
4. [المرحلة 4: الحفظ والسحب والرفع الاعتيادي (Add, Commit, Pull & Push)](#المرحلة-4-الحفظ-والسحب-والرفع-الاعتيادي)
5. [المرحلة 5: حل مشكلة رفض الرفع الشهيرة (Updates were rejected / Pull First)](#المرحلة-5-حل-مشكلة-رفض-الرفع-الشهيرة-pull-first)
6. [المرحلة 6: أوامر الطوارئ والتراجع وحفظ التعديلات المؤقتة (Stash & Undo)](#المرحلة-6-أوامر-الطوارئ-والتراجع-وحفظ-التعديلات-المؤقتة)
7. [المرحلة 7: جدول الملخص السريع وسيناريو العمل اليومي](#المرحلة-7-جدول-الملخص-السريع-وسيناريو-العمل-اليومي)

---

## المرحلة 1: تسجيل الدخول، فحص الحساب الفعّال، والتبديل بين الحسابات

هذه هي نقطة البداية الأولى والأساسية. قبل كتابة أي كود أو محاولة رفع أي ملف، يجب أن تعرف: **من أنت الآن أمام GitHub؟**

### 1.1 كيف أعرف الحساب الفعّال حالياً؟

#### الطريقة الأولى: باستخدام أداة GitHub الرسمية (`gh` - GitHub CLI) [الأسهل والأدق]
```bash
gh auth status
```
- **ماذا يعرض؟** يعرض لك فوراً الحساب المسجل به دخولك في GitHub (مثل: `Logged in to github.com account alahly13`).
- يوضح لك أيضاً هل التوثيق نشط وصالح أم انتهت صلاحيته.

#### الطريقة الثانية: فحص اسم وإيميل صاحب الـ Commits في Git محلياً
```bash
# فحص الحساب في هذا المشروع تحديداً:
git config user.name
git config user.email

# فحص الحساب الافتراضي العام على جهازك:
git config --global user.name
git config --global user.email
```
> **ملاحظة ذهبية:** `git config user.name` يحدد فقط **الاسم المكتوب بجانب التعديلات** (Author)، بينما صلاحية الرفع الفعلية إلى سيرفرات GitHub تُحدد عبر **GitHub CLI** أو **SSH Key** أو **Windows Credential Manager**.

---

### 1.2 تسجيل الدخول إلى حساب GitHub

#### عبر أداة GitHub CLI:
```bash
gh auth login
```
- ستسألك الأداة عدة أسئلة سريعة:
  1. `What account do you want to log in to?` اختر `GitHub.com`.
  2. `What is your preferred protocol for Git operations?` اختر `HTTPS` أو `SSH`.
  3. `Authenticate Git with your GitHub credentials?` اختر `Yes`.
  4. `How would you like to authenticate?` اختر `Login with a web browser` (سيفتح المتصفح لتأكيد الدخول بكود مكون من 8 أرقام/حروف).

---

### 1.3 التبديل بين حسابات متعددة (مثل `alahly13` و `MahdyHQ`)

#### الطريقة الاحترافية الأولى: عبر GitHub CLI (`gh auth switch`)
لو كنت مسجلاً لأكثر من حساب:
```bash
# عرض كل الحسابات المسجلة:
gh auth status

# التبديل إلى حساب معين بضغطة زر:
gh auth switch --user alahly13
# أو التبديل للحساب الآخر:
gh auth switch --user MahdyHQ
```

#### الطريقة الثانية: ضبط الاسم والإيميل لمشروع محدد فقط (بدون التأثير على باقي المشاريع)
إذا أردت أن يكون مشروع `youtube-discovery` يتبع حساب `alahly13` حصراً:
```bash
# ادخل فولدر المشروع ثم نفذ (بدون كلمة --global):
git config user.name "alahly13"
git config user.email "alahly13@example.com"
```
ولمشروع آخر تريد أن يتبع `MahdyHQ`:
```bash
git config user.name "MahdyHQ"
git config user.email "mahdy@example.com"
```

#### الطريقة الاحترافية الثالثة: عبر مفاتيح SSH المنفصلة (الأفضل عند الرفع المستمر)
1. إنشاء مفتاح لحساب `alahly13`:
   ```bash
   ssh-keygen -t ed25519 -C "alahly13" -f ~/.ssh/id_ed25519_alahly13
   ```
2. إنشاء مفتاح لحساب `MahdyHQ`:
   ```bash
   ssh-keygen -t ed25519 -C "MahdyHQ" -f ~/.ssh/id_ed25519_MahdyHQ
   ```
3. إضافة المفاتيح لملف `~/.ssh/config`:
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
4. إضافة الـ Public key (`.pub`) في إعدادات كل حساب على موقع GitHub (`Settings -> SSH and GPG Keys`).

---

### 1.4 تسجيل الخروج أو مسح الحسابات القديمة من النظام

#### تسجيل الخروج عبر GitHub CLI:
```bash
gh auth logout
```

#### مسح الحسابات القديمة والمعلقة من نظام Windows:
إذا كان Git يحاول دائماً الرفع بحساب قديم أو كلمة مرور منتهية الصلاحية:
1. افتح قائمة ابدأ في ويندوز واكتب: **Credential Manager** (أو "إدارة بيانات الاعتماد").
2. اضغط على **Windows Credentials**.
3. ابحث في القائمة عن أي سطر يبدأ بـ **`git:https://github.com`**.
4. اضغط عليه ثم اختر **Remove** (حذف).
5. عند تنفيذ أول أمر `git push` بعد ذلك، ستظهر لك نافذة تطلب منك تسجيل الدخول بالحساب الصحيح.

---

## المرحلة 2: فحص المستودعات والروابط (Remotes & Repositories)

الآن بعد التأكد من الحساب الصحيح، تأتي مرحلة فحص المستودع والروابط المتصل بها المشروع.

### 2.1 معرفة رابط المستودع المتصل بهذا المشروع حالياً
```bash
git remote -v
```
**مثال للناتج:**
```text
origin  https://github.com/alahly13/youtube-discovery.git (fetch)
origin  https://github.com/alahly13/youtube-discovery.git (push)
```
- `origin`: هو الاسم الافتراضي الشائع للرابط البعيد.
- الرابط يوضح المستودع الذي سيسحب منه (`fetch`) ويرفع إليه (`push`).

---

### 2.2 عرض قائمة المستودعات الخاصة بحسابك عبر سطر الأوامر
```bash
gh repo list
# أو لحساب معين:
gh repo list alahly13 --limit 10
```

---

### 2.3 تغيير رابط المستودع (Switching / Renaming Remote)
لو أردت توجيه المشروع إلى مستودع مختلف أو تم تغيير اسم الريبو:
```bash
git remote set-url origin https://github.com/alahly13/youtube-discovery.git
```
وللتأكد بعد التغيير:
```bash
git remote -v
```

---

### 2.4 ربط مشروع محلي جديد بمستودع GitHub لأول مرة
لو أنشأت مشروعاً على جهازك وتريد ربطه بريبو فارغ على GitHub:
```bash
# 1. تهيئة المستودع
git init

# 2. ربطه بالريبو البعيد
git remote add origin https://github.com/alahly13/youtube-discovery.git

# 3. تسمية الفرع الرئيسي main
git branch -M main
```

---

### 2.5 تنزيل (استنساخ) مستودع من GitHub إلى جهازك
```bash
git clone https://github.com/alahly13/youtube-discovery.git
cd youtube-discovery
```

---

## المرحلة 3: فحص الحالة والمقارنة والفروع

قبل إجراء أي عملية حفظ أو رفع، يجب فحص حالة المشروع وفهم ما الذي تم تعديله.

### 3.1 فحص حالة الملفات الحالية (الأمر الأكثر استخداماً)
```bash
git status
```
- **الملفات باللون الأحمر (Untracked / Modified):** ملفات تم تعديلها أو إنشاؤها ولم تُجهز للحفظ بعد.
- **الملفات باللون الأخضر (Changes to be committed):** ملفات جاهزة للـ Commit (تم عمل `git add` لها).

---

### 3.2 مقارنة التغييرات بدقة سطر بسطر (Diff)
```bash
# رؤية ما قمت بتعديله في الملفات قبل عمل git add:
git diff

# رؤية التعديلات المجهزة للحفظ بعد عمل git add:
git diff --staged

# مقارنة ملف واحد محدد:
git diff src/components/search/search-workspace.tsx
```

---

### 3.3 فحص الفروع والتبديل بينها (Branches)
```bash
# معرفة الفرع الحالي الذي تقف عليه:
git branch --show-current

# عرض جميع الفروع المحلية:
git branch

# عرض جميع الفروع المحلية والبعيدة على GitHub:
git branch -a

# إنشاء فرع جديد للعمل على ميزة والانتقال إليه فوراً:
git switch -c feature/new-search-filters
# أو بالطريقة القديمة:
git checkout -b feature/new-search-filters

# العودة إلى الفرع الرئيسي:
git switch main
# أو:
git checkout main
```

---

### 3.4 استعراض سجل التعديلات السابقة (History / Log)
```bash
# عرض آخر 10 تعديلات في سطر واحد مختصر:
git log --oneline -n 10

# عرض رسم بياني لتاريخ الفروع والتعديلات:
git log --oneline --graph --decorate -n 10
```

---

## المرحلة 4: الحفظ والسحب والرفع الاعتيادي

هذه هي دورة العمل الطبيعية عندما تسير الأمور بسلاسة بدون تضارب:

### الخطوة 1: تجهيز الملفات المعدلة (Stage)
```bash
# إضافة جميع الملفات المعدلة والجديدة:
git add .

# أو إضافة ملف أو مجلد محدد فقط:
git add src/components/search/search-workspace.tsx
```

---

### الخطوة 2: حفظ التغييرات محلياً مع كتابة رسالة واضحة (Commit)
```bash
git commit -m "Enhance search workspace and add save search titles feature"
```
> **نصيحة ذهبية:** اجعل رسالة الـ Commit واضحة وموجزة تصف ما قمت بإنجازه، مثل: `"Fix ESLint hook errors and update dark mode styling"`.

---

### الخطوة 3: سحب التحديثات من GitHub أولاً (Best Practice)
```bash
git pull origin main
```
- للتأكد دائماً أن جهازك يمتلك آخر نسخة موجودة على GitHub قبل محاولة رفع شغلك.

---

### الخطوة 4: رفع التعديلات إلى GitHub (Push)
```bash
# لو كان الفرع مربوطاً بالفعل:
git push origin main

# لو كنت ترفع هذا الفرع لأول مرة إلى GitHub:
git push -u origin main
```
- المعامل `-u` (أو `--set-upstream`) يربط فرعك المحلي بالفرع البعيد، بحيث يمكنك في المرات القادمة كتابة `git push` أو `git pull` فقط باختصار.

---

## المرحلة 5: حل مشكلة رفض الرفع الشهيرة (Pull First)

كثيراً ما تواجه هذه الرسالة المزعجة أثناء تنفيذ `git push`:

```text
! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'https://github.com/alahly13/youtube-discovery.git'
hint: Updates were rejected because the remote contains work that you do
hint: not have locally. This is usually caused by another repository pushing
hint: to the same ref. You may want to first integrate the remote changes
hint: (e.g., 'git pull ...') before pushing again.
```

### لماذا تظهر هذه المشكلة؟
تظهر لأن سيرفر GitHub يحتوي على تعديلات أو Commit جديدة (قمت بها أنت من المتصفح، أو من جهاز آخر، أو قام بها زميل لك) ليست موجودة على جهازك بعد، لذلك يرفض Git الرفع حمايةً للكود من أن يُمحى بالخطأ.

---

### خطوات الحل الدقيقة بالترتيب:

#### الخطوة 1: نفّذ السحب مع Rebase (الحل الأنظف والأفضل)
```bash
git pull origin main --rebase
```
- **لماذا `--rebase`؟** لأنه يسحب التعديلات الجديدة من GitHub ويضع تعديلاتك أنت فوقها مباشرة في خط زمني مستقيم بدون إنشاء Commit دمج مزعجة (`Merge branch 'main' of...`).

---

#### الخطوة 2 (لو لم تكن هناك أي ملفات متعارضة):
سيتم الدمج بنجاح تلقائياً! والآن يمكنك الرفع فوراً:
```bash
git push origin main
```
**مبروك، تم حل المشكلة ورُفع الكود بنجاح!**

---

#### الخطوة 3 (ماذا لو ظهر لك تعارض Conflict؟):
إذا كنت قد عدلت على نفس السطور التي عُدلت في GitHub، سيخبرك Git بوجود Conflict:
```text
CONFLICT (content): Merge conflict in src/app/page.tsx
Automatic merge failed; fix conflicts and then commit the result.
```

**كيف تحلها بسهولة؟**
1. افتح الملف المذكور في محرر الأكواد (مثل VS Code أو محرر المشروع)، ستجد علامات التعارض بهذا الشكل:
   ```text
   <<<<<<< HEAD (التعديل القادم من GitHub)
   كود موجود على السيرفر
   =======
   كودك أنت الذي كتبته على جهازك
   >>>>>>> [commit id]
   ```
2. قم بمسح السطور الزائدة واختر الكود الصحيح الذي تريده أن يبقى.
3. بعد حفظ الملف بعد التعديل، أبلغ Git أنك أنهيت حل التعارض:
   ```bash
   git add .
   git rebase --continue
   ```
   *(إذا كنت قد استخدمت pull عادي بدون rebase فبدلاً منها نفّذ `git commit -m "Resolve merge conflicts"`).*
4. الآن ارفع كودك إلى GitHub:
   ```bash
   git push origin main
   ```

---

### تحذير صارم بخصوص `--force`:
- **لا تستخدم مطلقاً `git push --force`** لأنها قد تمسح شغل الآخرين أو تعديلات مهمة على GitHub بلا رجعة.
- إذا كنت واثقاً تماماً وتريد إجبار الرفع دون خطر مسح عمل غيرك، استخدم دائماً:
  ```bash
  git push --force-with-lease origin main
  ```
  فهذا الأمر يتأكد أن أحداً لم يقم برفع أي شيء جديد على GitHub قبل إجبار الرفع.

---

## المرحلة 6: أوامر الطوارئ والتراجع وحفظ التعديلات المؤقتة

أوامر منقذة تحتاجها عند وقوع أخطاء أو الحاجة لتجربة شيء ثم التراجع عنه:

### 6.1 حفظ التعديلات مؤقتاً في مسودة (Git Stash)
لو كنت تعمل على تعديلات ولم تنتهِ منها بعد، وتريد عمل `git pull` أو التبديل لفرع آخر بدون commit:
```bash
# 1. إخفاء التعديلات مؤقتاً في المخزن السري:
git stash

# 2. الآن يمكنك عمل pull بأمان:
git pull origin main

# 3. استرجاع تعديلاتك وإعادتها لملفاتك:
git stash pop
```

---

### 6.2 التراجع عن تعديل ملف محلي لم تقم بحفظه (Discard changes)
```bash
# التراجع عن التعديلات في ملف واحد وإعادته كما كان:
git restore src/app/page.tsx

# التراجع عن التعديلات في كل ملفات المشروع دفعة واحدة:
git restore .
```

---

### 6.3 إلغاء `git add` (Unstaging)
لو قمت بعمل `git add .` وتريد إلغاء التجهيز قبل عمل الـ commit:
```bash
git restore --staged .
# أو لملف معين:
git restore --staged src/app/page.tsx
```

---

### 6.4 التراجع عن آخر Commit محلي (مع الاحتفاظ بالتعديلات في الكود)
لو عملت commit بالخطأ وتريد التراجع عنه دون فقدان كودك:
```bash
git reset --soft HEAD~1
```
- سيلغي آخر commit، وسيبقى كودك موجوداً وجاهزاً للتعديل وإعادة الـ commit.

---

## المرحلة 7: جدول الملخص السريع وسيناريو العمل اليومي

### سيناريو العمل اليومي الموصى به (في 4 خطوات):
```bash
# 1. فحص الحالة
git status

# 2. سحب آخر التحديثات
git pull origin main --rebase

# 3. تجهيز وحفظ تعديلاتك
git add .
git commit -m "اكتب وصف التعديل هنا"

# 4. الرفع إلى GitHub
git push origin main
```

---

### كارت الأوامر السريع (Cheatsheet):

```text
===================================================================================
👤 أوامر الحسابات والتوثيق (Accounts & Auth):
-----------------------------------------------------------------------------------
gh auth status                     # معرفة الحساب الفعال حالياً على GitHub
gh auth switch --user <name>       # التبديل السريع بين حسابات متعددة
gh auth login                      # تسجيل دخول جديد عبر المتصفح
gh auth logout                     # تسجيل الخروج
git config user.name               # عرض اسم صاحب الـ Commit الحالي
git config user.name "alahly13"    # تحديد اسم الحساب لهذا المشروع فقط
-----------------------------------------------------------------------------------
🌐 أوامر الروابط والمستودعات (Remotes & Repos):
-----------------------------------------------------------------------------------
git remote -v                      # معرفة روابط GitHub المتصل بها المشروع
git remote set-url origin <url>    # تعديل أو تغيير رابط المستودع
git clone <url>                    # تنزيل مستودع جديد إلى جهازك
-----------------------------------------------------------------------------------
🔍 أوامر الفحص والمقارنة (Inspect & Branches):
-----------------------------------------------------------------------------------
git status                         # فحص حالة الملفات المعدلة والجديدة
git diff                           # عرض تفاصيل التعديلات سطر بسطر
git branch --show-current          # معرفة اسم الفرع الحالي
git switch -c <branch-name>        # إنشاء فرع جديد والتبديل إليه
git log --oneline -n 10            # استعراض آخر 10 تعديلات سابقة
-----------------------------------------------------------------------------------
🚀 أوامر الحفظ والرفع وحل مشاكل السحب:
-----------------------------------------------------------------------------------
git add .                          # تجهيز كل التعديلات للحفظ
git commit -m "رسالة التعديل"      # حفظ التعديلات محلياً
git pull origin main --rebase      # سحب التحديثات بأمان وتجنب تضارب التعديلات
git push origin main               # رفع التعديلات إلى GitHub
git push -u origin main            # رفع الفرع لأول مرة وضبطه كفرع افتراضي
-----------------------------------------------------------------------------------
🛡️ أوامر الطوارئ والتراجع (Stash & Undo):
-----------------------------------------------------------------------------------
git stash                          # تخزين التعديلات مؤقتاً لسحب التحديثات
git stash pop                      # استعادة التعديلات المخزنة
git restore <file>                 # إلغاء أي تعديل محلي في ملف وإعادته لأصله
git reset --soft HEAD~1            # إلغاء آخر commit محلي دون فقدان الكود
===================================================================================
```

---
*تم تنظيم وتحديث هذا الدليل بالكامل ليكون دليلك المنطقي الشامل داخل مجلد `Guide-Files/`.*
