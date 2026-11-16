#!/usr/bin/env bash
# One-time setup of the AWS side of .github/workflows/backup-storage.yml, in
# Columnaquiro's own AWS account. Idempotent: safe to run again. Meant for
# AWS CloudShell, which is already signed in as the account:
#
#   ./scripts/backup-storage-aws-setup.sh
#
# Creates, in eu-north-1 (Stockholm):
#   - a private, versioned bucket for the copies;
#   - an IAM user that can list the bucket and write objects -- and nothing
#     else. It cannot READ the copies (the backup never needs to) and is
#     explicitly denied every delete and every change to versioning,
#     lifecycle or the bucket policy, so a leaked key can add versions but
#     cannot destroy or unprotect what is already there.
#
# Why a user with a stored key rather than GitHub OIDC and a role, and why not
# eu-south-2 (Spain): the account sits in an AWS-managed organization whose
# service control policy denies iam:CreateOpenIDConnectProvider and every
# region opt-in. Both were tried on 15 Nov 2026. eu-north-1 is enabled by
# default and is in the EU; it is also a different region from Supabase's
# (eu-west-1), so a regional outage does not take both copies.
#
# It does not create the access key: that is printed once and has to go
# straight into the repository secrets, so do it by hand (see the end).
set -euo pipefail

REGION=eu-north-1
USER_NAME=quiroflow-storage-backup
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET=quiroflow-storage-backup-$ACCOUNT

if ! aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
fi
aws s3api put-public-access-block --region "$REGION" --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --region "$REGION" --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-ownership-controls --region "$REGION" --bucket "$BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'

PERMISSIONS=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::$BUCKET" },
    { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::$BUCKET/*" },
    {
      "Effect": "Deny",
      "Action": [
        "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:DeleteBucket",
        "s3:PutBucketVersioning", "s3:PutLifecycleConfiguration",
        "s3:PutBucketPolicy", "s3:DeleteBucketPolicy",
        "s3:PutObjectAcl", "s3:PutBucketAcl", "s3:PutBucketPublicAccessBlock"
      ],
      "Resource": ["arn:aws:s3:::$BUCKET", "arn:aws:s3:::$BUCKET/*"]
    }
  ]
}
JSON
)

if ! aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  aws iam create-user --user-name "$USER_NAME" >/dev/null
fi
aws iam put-user-policy --user-name "$USER_NAME" --policy-name write-only-backup --policy-document "$PERMISSIONS"

echo
echo "Repository variable (Settings -> Secrets and variables -> Actions -> Variables):"
echo "  BACKUP_BUCKET=$BUCKET"
echo
echo "Then create the user's access key (IAM -> Users -> $USER_NAME -> Security"
echo "credentials -> Create access key) and store it as the repository secrets"
echo "BACKUP_ACCESS_KEY_ID and BACKUP_SECRET_ACCESS_KEY."
