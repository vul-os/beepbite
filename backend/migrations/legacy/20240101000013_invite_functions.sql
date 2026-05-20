-- RPC functions for invite management.
-- `p_user_id` replaces supabase `auth.uid()`; Go handler passes it from the JWT.

CREATE OR REPLACE FUNCTION check_invites(p_user_id uuid)
RETURNS TABLE (
    invite_id uuid,
    organization_id uuid,
    organization_name text,
    invited_by_name text,
    role text,
    created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    current_user_email text;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required';
    END IF;

    SELECT email INTO current_user_email
    FROM profiles
    WHERE id = p_user_id;

    IF current_user_email IS NULL THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    RETURN QUERY
    SELECT
        oi.id as invite_id,
        oi.organization_id,
        o.name as organization_name,
        COALESCE(p.full_name, p.username, 'Unknown') as invited_by_name,
        oi.role,
        oi.created_at
    FROM organization_invites oi
    JOIN organizations o ON oi.organization_id = o.id
    LEFT JOIN profiles p ON oi.invited_by = p.id
    WHERE oi.email = current_user_email
    AND oi.status = 'pending'
    AND o.is_active = true
    ORDER BY oi.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION respond_invitation(
    p_user_id uuid,
    p_invite_id uuid,
    p_accept boolean
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    current_user_email text;
    invite_record organization_invites%ROWTYPE;
    result json;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'user_id is required');
    END IF;

    SELECT email INTO current_user_email
    FROM profiles
    WHERE id = p_user_id;

    IF current_user_email IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'User profile not found');
    END IF;

    SELECT oi.* INTO invite_record
    FROM organization_invites oi
    JOIN organizations o ON oi.organization_id = o.id
    WHERE oi.id = p_invite_id
    AND oi.email = current_user_email
    AND oi.status = 'pending'
    AND o.is_active = true;

    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'No pending invitation found or invitation expired'
        );
    END IF;

    IF p_accept THEN
        UPDATE organization_invites
        SET status = 'accepted', updated_at = now()
        WHERE id = invite_record.id;

        INSERT INTO organization_members (organization_id, profile_id, role)
        VALUES (invite_record.organization_id, p_user_id, invite_record.role)
        ON CONFLICT (organization_id, profile_id) DO UPDATE SET
            role = EXCLUDED.role,
            updated_at = now();

        result := json_build_object(
            'success', true,
            'message', 'Invitation accepted successfully',
            'organization_id', invite_record.organization_id,
            'role', invite_record.role
        );
    ELSE
        UPDATE organization_invites
        SET status = 'rejected', updated_at = now()
        WHERE id = invite_record.id;

        result := json_build_object(
            'success', true,
            'message', 'Invitation rejected'
        );
    END IF;

    RETURN result;
EXCEPTION WHEN others THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION send_invitation(
    p_user_id uuid,
    p_organization_id uuid,
    p_email text,
    p_role text DEFAULT 'staff'
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    organization_exists boolean;
    user_is_member boolean;
    user_role text;
    invite_exists boolean;
    user_already_member boolean;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'user_id is required');
    END IF;

    IF p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RETURN json_build_object('success', false, 'error', 'Invalid email format');
    END IF;

    IF p_role NOT IN ('owner', 'manager', 'staff', 'admin') THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Invalid role. Must be owner, manager, staff, or admin'
        );
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organizations
        WHERE id = p_organization_id AND is_active = true
    ) INTO organization_exists;

    IF NOT organization_exists THEN
        RETURN json_build_object('success', false, 'error', 'Organization not found or inactive');
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organization_members
        WHERE organization_id = p_organization_id AND profile_id = p_user_id
    ), COALESCE(
        (SELECT role FROM organization_members
         WHERE organization_id = p_organization_id AND profile_id = p_user_id),
        'none'
    ) INTO user_is_member, user_role;

    IF NOT user_is_member THEN
        RETURN json_build_object('success', false, 'error', 'You are not a member of this organization');
    END IF;

    IF user_role NOT IN ('owner', 'manager', 'admin') THEN
        RETURN json_build_object('success', false, 'error', 'Insufficient permissions to send invitations');
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organization_members om
        JOIN profiles p ON om.profile_id = p.id
        WHERE om.organization_id = p_organization_id AND p.email = p_email
    ) INTO user_already_member;

    IF user_already_member THEN
        RETURN json_build_object('success', false, 'error', 'User is already a member of this organization');
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organization_invites
        WHERE organization_id = p_organization_id
        AND email = p_email
        AND status = 'pending'
    ) INTO invite_exists;

    IF invite_exists THEN
        RETURN json_build_object('success', false, 'error', 'A pending invitation already exists for this email');
    END IF;

    INSERT INTO organization_invites (organization_id, email, invited_by, role, status)
    VALUES (p_organization_id, p_email, p_user_id, p_role, 'pending');

    RETURN json_build_object(
        'success', true,
        'message', 'Invitation sent successfully',
        'invited_email', p_email,
        'role', p_role
    );
EXCEPTION WHEN others THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_invitation(
    p_user_id uuid,
    p_invite_id uuid
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    user_role text;
    invite_record organization_invites%ROWTYPE;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'user_id is required');
    END IF;

    SELECT * INTO invite_record
    FROM organization_invites
    WHERE id = p_invite_id AND status = 'pending';

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Invitation not found or already processed');
    END IF;

    SELECT role INTO user_role
    FROM organization_members
    WHERE organization_id = invite_record.organization_id
    AND profile_id = p_user_id;

    IF user_role IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'You are not a member of this organization');
    END IF;

    IF user_role NOT IN ('owner', 'manager', 'admin') THEN
        RETURN json_build_object('success', false, 'error', 'Insufficient permissions to cancel invitations');
    END IF;

    DELETE FROM organization_invites WHERE id = p_invite_id;

    RETURN json_build_object('success', true, 'message', 'Invitation cancelled successfully');
EXCEPTION WHEN others THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION list_organization_invitations(
    p_user_id uuid,
    p_organization_id uuid
)
RETURNS TABLE (
    invite_id uuid,
    email text,
    role text,
    invited_by_name text,
    created_at timestamptz,
    status text
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    user_role text;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required';
    END IF;

    SELECT role INTO user_role
    FROM organization_members
    WHERE organization_id = p_organization_id
    AND profile_id = p_user_id;

    IF user_role IS NULL THEN
        RAISE EXCEPTION 'You are not a member of this organization';
    END IF;

    IF user_role NOT IN ('owner', 'manager', 'admin') THEN
        RAISE EXCEPTION 'Insufficient permissions to view invitations';
    END IF;

    RETURN QUERY
    SELECT
        oi.id as invite_id,
        oi.email,
        oi.role,
        COALESCE(p.full_name, p.username, 'Unknown') as invited_by_name,
        oi.created_at,
        oi.status
    FROM organization_invites oi
    LEFT JOIN profiles p ON oi.invited_by = p.id
    WHERE oi.organization_id = p_organization_id
    ORDER BY oi.created_at DESC;
END;
$$;
