#!/usr/bin/env bash
# One-time setup of the AWS side of .github/workflows/backup-storage.yml, in
# Columnaquiro's own AWS account. Idempotent: safe to run again.
#
#   AWS_PROFILE=columnaquiro ./scripts/backup-storage-aws-setup.sh
#
# Creates, in eu-south-2 (Spain):
#   - a private, versioned bucket for the copies;
#   - GitHub's OIDC identity provider, so the workflow needs no stored AWS key;
#   - a role only ColumnaQuiro/quiroflow's main branch can assume, which can
#     list the bucket and write objects -- and nothing else. It cannot READ the
#     copies (the backup never needs to) and is explicitly denied every delete
#     and every change to versioning, lifecycle or the bucket policy, so a
#     compromised workflow can add versions but cannot destroy or unprotect
#     what is already there.
#
# Prints the two repository variables the workflow reads.
set -euo pipefail

REGION=eu-south-2
REPO=ColumnaQuiro/quiroflow
ROLE=quiroflow-storage-backup
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET=quiroflow-storage-backup-$ACCOUNT
OIDC=token.actions.githubusercontent.com

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'

if ! aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn "arn:aws:iam::$ACCOUNT:oidc-provider/$OIDC" >/dev/null 2>&1; then
  # AWS no longer checks the thumbprint for GitHub's provider, but the API
  # still requires one.
  aws iam create-open-id-connect-provider --url "https://$OIDC" \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
fi

TRUST=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::$ACCOUNT:oidc-provider/$OIDC" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "$OIDC:aud": "sts.amazonaws.com",
        "$OIDC:sub": "repo:$REPO:ref:refs/heads/main"
      }
    }
  }]
}
JSON
)

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

if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"
else
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" \
    --description "GitHub Actions: nightly copy of QuiroFlow's Supabase Storage files" >/dev/null
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name write-only-backup --policy-document "$PERMISSIONS"

echo
echo "Repository variables (Settings -> Secrets and variables -> Actions -> Variables):"
echo "  BACKUP_BUCKET=$BUCKET"
echo "  BACKUP_AWS_ROLE_ARN=arn:aws:iam::$ACCOUNT:role/$ROLE"
