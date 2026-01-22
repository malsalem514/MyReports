# Microsoft Entra ID SSO Configuration Guide

This guide explains how to configure Microsoft Entra ID (formerly Azure AD) Single Sign-On with Clerk for the HR Dashboard.

## Prerequisites

- Microsoft Entra ID tenant with admin access
- Clerk account with Pro plan (for SAML SSO support)
- HR Dashboard deployed to a production URL

## Phase 1: Microsoft Entra ID Setup

### Step 1: Create Enterprise Application

1. Sign in to the [Azure Portal](https://portal.azure.com)
2. Navigate to **Microsoft Entra ID** > **Enterprise Applications**
3. Click **+ New application**
4. Click **+ Create your own application**
5. Enter name: `HR Dashboard`
6. Select "Integrate any other application you don't find in the gallery (Non-gallery)"
7. Click **Create**

### Step 2: Configure SAML SSO

1. In your new application, go to **Single sign-on**
2. Select **SAML** as the single sign-on method
3. In **Basic SAML Configuration**, enter:

   | Setting | Value |
   |---------|-------|
   | Identifier (Entity ID) | `https://clerk.your-domain.com` |
   | Reply URL (ACS URL) | `https://clerk.your-domain.com/v1/saml/acs` |
   | Sign on URL | `https://your-app-domain.com/auth/sign-in` |

4. Click **Save**

### Step 3: Configure User Attributes & Claims

1. In the **User Attributes & Claims** section, click **Edit**
2. Ensure the following claims are configured:

   | Claim Name | Source Attribute |
   |------------|-----------------|
   | `emailaddress` | `user.mail` |
   | `givenname` | `user.givenname` |
   | `surname` | `user.surname` |
   | `name` | `user.displayname` |

### Step 4: Download SAML Certificate

1. In **SAML Signing Certificate** section
2. Download **Federation Metadata XML**
3. Save this file - you'll upload it to Clerk

### Step 5: Assign Users

1. Go to **Users and groups**
2. Click **+ Add user/group**
3. Assign the users or groups who should have access

## Phase 2: Clerk Configuration

### Step 1: Enable SAML SSO

1. Log in to [Clerk Dashboard](https://dashboard.clerk.com)
2. Navigate to your application
3. Go to **Configure** > **SSO Connections**
4. Click **+ Add connection**
5. Select **SAML**

### Step 2: Upload Entra ID Metadata

1. In the SAML connection setup:
   - **Connection Name**: `Microsoft Entra ID`
   - **Provider Type**: `Custom SAML`
2. Upload the **Federation Metadata XML** file from Step 4 above
3. Or manually enter:
   - **Sign-in URL**: From Azure Portal (Login URL)
   - **Certificate**: From Azure Portal (Certificate Base64)
   - **Entity ID**: From Azure Portal (Azure AD Identifier)

### Step 3: Configure Attribute Mapping

Map Entra ID claims to Clerk fields:

| Entra ID Claim | Clerk Field |
|----------------|-------------|
| `emailaddress` | `email_address` |
| `givenname` | `first_name` |
| `surname` | `last_name` |

### Step 4: Configure Domain

1. Add your organization's email domain (e.g., `@company.com`)
2. Enable **Domain restriction** if you want to limit access

### Step 5: Save and Test

1. Click **Save**
2. Click **Test connection** to verify the setup
3. You should be redirected to Microsoft login and back

## Phase 3: Application Configuration

### Update Environment Variables

No additional environment variables needed - Clerk handles SSO configuration through its dashboard.

### Update Clerk Providers (if needed)

The existing `ClerkProvider` setup in `src/components/layout/providers.tsx` should work without changes.

## Testing the Integration

### Test SSO Flow

1. Open your HR Dashboard in an incognito window
2. Click **Sign In**
3. Enter your corporate email address
4. Clerk should redirect you to Microsoft login
5. After authentication, you should be redirected back to the dashboard

### Test Access Control

1. Log in as a manager
2. Verify you can only see your direct reports
3. Log in as an HR admin
4. Verify you can see all employees

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Invalid SAML Response" | Check ACS URL matches exactly in both systems |
| User not assigned | Add user to Enterprise App in Azure Portal |
| Claims not mapping | Verify attribute names match exactly |
| Redirect loop | Check Sign-on URL is correct |

## Security Considerations

1. **Enable MFA** in Microsoft Entra ID for all users
2. **Conditional Access**: Consider requiring managed devices
3. **Session Timeout**: Configure appropriate session lengths in both Clerk and Entra ID
4. **Audit Logging**: Enable sign-in logs in Azure for monitoring

## Support

- [Clerk SAML Documentation](https://clerk.com/docs/authentication/saml)
- [Microsoft Entra ID SAML Guide](https://docs.microsoft.com/azure/active-directory/manage-apps/add-application-portal-setup-sso)
