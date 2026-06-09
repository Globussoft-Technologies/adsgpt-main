// =============================================================================
// Mirror to public CI repo  (Jenkins port of .github/workflows/mirror-to-public.yml)
// =============================================================================
// Auto-syncs four folders from THIS private repo to the public CI/CD repo:
//   nodejs-backend, nodejs-ads-backend, react-frontend, react-admin
//
// Source of truth: this private repo. The public repo is a downstream mirror
// whose existing CI workflows, deploy pipelines, README, LICENSE, docs,
// .gitignore, .claude, etc. are PRESERVED — only the 4 folders are touched.
//
// Safety: only TRACKED files are copied (via `git ls-files`), so .env files and
// other gitignored secrets cannot leak. A second find-based check refuses to
// commit if a .env / .pem / .key somehow ended up staged.
//
// -----------------------------------------------------------------------------
// Required Jenkins configuration
// -----------------------------------------------------------------------------
//   Credential (Manage Jenkins -> Credentials):
//     ID 'mirror-token'  -> "Secret text"  = fine-grained PAT with
//                            Contents: Read & Write on the DESTINATION repo ONLY.
//
//   Job setup:
//     - Pipeline (or Multibranch) job using "Pipeline script from SCM",
//       pointed at THIS private repo, branch main, Script Path = Jenkinsfile.
//     - For push triggering: install the GitHub plugin, add a webhook on the
//       private repo to https://<jenkins>/github-webhook/ (push events), and
//       keep the githubPush() trigger below.
// -----------------------------------------------------------------------------

pipeline {
  agent any

  parameters {
    booleanParam(
      name: 'DRY_RUN',
      defaultValue: false,
      description: 'Stage and diff, but do not push to the public repo.'
    )
    string(
      name: 'PUBLIC_REPO',
      defaultValue: 'Globussoft-Technologies/adsgpt-main',
      description: 'Destination "owner/repo".'
    )
  }

  options {
    // Never overlap two mirror runs.
    disableConcurrentBuilds()
    timeout(time: 15, unit: 'MINUTES')
    timestamps()
  }

  triggers {
    // Fires when GitHub sends a push webhook for this repo.
    // (Path filtering is handled by the content-diff gate in 'Detect changes'.)
    githubPush()
  }

  environment {
    // Auto-masked in console output by Jenkins.
    MIRROR_TOKEN = credentials('mirror-token')
    FOLDERS      = 'nodejs-backend nodejs-ads-backend react-frontend react-admin'
  }

  stages {

    stage('Validate configuration') {
      steps {
        script {
          if (!params.PUBLIC_REPO?.trim()) {
            error 'Parameter PUBLIC_REPO is empty.'
          }
          if (!params.PUBLIC_REPO.contains('/')) {
            error "PUBLIC_REPO must be in 'owner/repo' format (got: ${params.PUBLIC_REPO})"
          }
          // MIRROR_TOKEN is bound via credentials(); if the credential is
          // missing the build fails earlier with a clear binding error.
          // Capture the private repo's commit for the mirror commit message.
          env.PRIVATE_SHA = (env.GIT_COMMIT ?: sh(script: 'git rev-parse HEAD', returnStdout: true)).trim()
          echo "Private source commit: ${env.PRIVATE_SHA}"
          echo "Public destination:    ${params.PUBLIC_REPO}"
        }
      }
    }

    // The private repo is already checked out into the workspace root by the
    // "Pipeline script from SCM" step. We clone the public repo into ./public.
    stage('Clone public repo (destination)') {
      steps {
        sh '''
          set -e
          rm -rf public
          # Clone full main of the public repo so its existing files
          # (workflows, docs, README, .gitignore, etc.) stay intact.
          git clone \
            --branch main \
            --depth 1 \
            "https://x-access-token:${MIRROR_TOKEN}@github.com/${PUBLIC_REPO}.git" \
            public
        '''
      }
    }

    stage('Replace the four folders in the public clone') {
      steps {
        sh '''
          set -e
          for FOLDER in $FOLDERS; do
            if [ ! -d "$FOLDER" ]; then
              echo "WARNING: source folder $FOLDER missing — skipping"
              continue
            fi

            # Wipe public's copy so deletions in private propagate.
            rm -rf "public/$FOLDER"
            mkdir -p "public/$FOLDER"

            # Copy only TRACKED files from private. Anything gitignored
            # (.env, node_modules, dist, logs, etc.) is automatically skipped.
            COUNT=0
            while IFS= read -r f; do
              [ -z "$f" ] && continue
              mkdir -p "public/$(dirname "$f")"
              cp "$f" "public/$f"
              COUNT=$((COUNT + 1))
            done <<EOF
$(git ls-files -- "$FOLDER")
EOF

            echo "Synced $COUNT tracked files into public/$FOLDER"
          done
        '''
      }
    }

    stage('Safety net — block sensitive files') {
      steps {
        sh '''
          set -e
          cd public
          # Final find on the destination staging tree before commit.
          # Allow .env.example, block real secrets.
          BAD=$(find . -path ./.git -prune -o -type f \\( \
              -name '.env' -o \
              -name '.env.local' -o \
              -name '.env.production' -o \
              -name '.env.development' -o \
              -name '*.pem' -o \
              -name '*.key' -o \
              -name 'service-account*.json' -o \
              -name 'credentials.json' \
            \\) -print)
          if [ -n "$BAD" ]; then
            echo "ERROR: Refusing to commit — sensitive file(s) found:"
            echo "$BAD"
            exit 1
          fi
          echo "Safety check passed."
        '''
      }
    }

    stage('Detect changes') {
      steps {
        dir('public') {
          sh 'git add -A'
          script {
            // `git diff --cached --quiet` exits 0 when nothing is staged.
            def rc = sh(script: 'git diff --cached --quiet', returnStatus: true)
            if (rc == 0) {
              echo 'No content changes between private and public.'
              env.HAS_CHANGES = 'false'
            } else {
              echo 'Changes detected:'
              sh 'git diff --cached --stat'
              env.HAS_CHANGES = 'true'
            }
          }
        }
      }
    }

    stage('Commit') {
      when { expression { env.HAS_CHANGES == 'true' } }
      steps {
        dir('public') {
          sh '''
            set -e
            git config user.email "mirror-bot@users.noreply.github.com"
            git config user.name  "AdsGPT Mirror Bot"
            SHORT_SHA=$(echo "$PRIVATE_SHA" | cut -c1-7)
            git commit -q -m "chore: mirror from private @ ${SHORT_SHA}

Upstream commit:  ${PRIVATE_SHA}
Upstream branch:  ${GIT_BRANCH:-main}
Triggered by:     Jenkins (${BUILD_TAG})
Mirror build:     ${BUILD_URL}"
            git log --oneline -1
          '''
        }
      }
    }

    stage('Push to public') {
      when {
        allOf {
          expression { env.HAS_CHANGES == 'true' }
          expression { !params.DRY_RUN }
        }
      }
      steps {
        dir('public') {
          // origin already carries the token from the clone URL.
          sh 'git push origin main'
          echo "Mirrored to https://github.com/${params.PUBLIC_REPO}"
        }
      }
    }

    stage('Dry run — skipped push') {
      when {
        allOf {
          expression { params.DRY_RUN }
        }
      }
      steps {
        script {
          if (env.HAS_CHANGES == 'true') {
            echo 'Dry run — staged & committed locally but skipped push. See diff stats above.'
          } else {
            echo 'Dry run — no changes detected anyway.'
          }
        }
      }
    }
  }

  post {
    success {
      script {
        if (env.HAS_CHANGES == 'true' && !params.DRY_RUN) {
          echo "✅ Mirror complete — pushed changes to ${params.PUBLIC_REPO}"
        } else if (env.HAS_CHANGES == 'true') {
          echo "ℹ️ Dry run finished — changes staged but not pushed."
        } else {
          echo "ℹ️ No changes to mirror — private and public are already in sync."
        }
      }
    }
    cleanup {
      // The local public clone is disposable; remove it to keep the workspace tidy.
      sh 'rm -rf public || true'
    }
  }
}
