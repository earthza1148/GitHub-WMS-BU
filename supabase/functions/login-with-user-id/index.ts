import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function publicProfile(profile: Record<string, unknown>) {
  const { password: _password, ...safeProfile } = profile;
  return safeProfile;
}

function isInactiveStatus(status: unknown) {
  const normalized = String(status ?? '').trim().toLowerCase();
  return status === false || normalized === 'false' || normalized === 'inactive';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method === 'GET') {
    return jsonResponse({ ok: true, function: 'login-with-user-id' });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Server login configuration is missing' }, 500);
  }

  try {
    const body = await req.json();
    const userId = String(body?.user_id || '').trim();
    const password = String(body?.password || '');

    if (!userId || !password) {
      return jsonResponse({ error: 'กรุณากรอก User ID และ Password' });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const publicClient = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: profile, error: profileError } = await adminClient
      .from('User Master')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      return jsonResponse({ error: 'ไม่พบ User ID นี้ใน User Master' });
    }

    const profileUid = String(profile.uid || '').trim();
    if (!profileUid) {
      return jsonResponse({ error: 'User Master ของ User ID นี้ยังไม่ได้ใส่ uid' });
    }

    const { data: authUserData, error: authUserError } = await adminClient.auth.admin.getUserById(
      profileUid,
    );

    if (authUserError || !authUserData?.user) {
      return jsonResponse({ error: 'uid ใน User Master ไม่ตรงกับผู้ใช้ใน Supabase Auth' });
    }

    if (!authUserData.user.email) {
      return jsonResponse({ error: 'ผู้ใช้ใน Supabase Auth ไม่มี email' });
    }

    if (isInactiveStatus(profile.status)) {
      return jsonResponse({ error: 'บัญชีนี้ถูกระงับการใช้งาน' });
    }

    if (String(profile.password || '') !== password) {
      return jsonResponse({ error: 'User ID หรือ Password ไม่ถูกต้อง' });
    }

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: authUserData.user.email,
    });

    const tokenHash = linkData?.properties?.hashed_token || linkData?.properties?.token_hash;
    if (linkError || !tokenHash) {
      return jsonResponse({
        error: `สร้าง session จาก Supabase Auth ไม่สำเร็จ: ${linkError?.message || 'Missing token hash'}`,
      });
    }

    const { data: sessionData, error: sessionError } = await publicClient.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    });

    if (sessionError || !sessionData.session || !sessionData.user) {
      return jsonResponse({
        error: `ยืนยัน session จาก Supabase Auth ไม่สำเร็จ: ${sessionError?.message || 'Unknown auth error'}`,
      });
    }

    if (sessionData.user.id !== profileUid) {
      return jsonResponse({ error: 'Auth UID ที่สร้าง session ได้ไม่ตรงกับ uid ใน User Master' });
    }

    return jsonResponse({
      session: sessionData.session,
      user: sessionData.user,
      profile: publicProfile(profile),
    });
  } catch (error) {
    console.error('login-with-user-id failed:', error);
    return jsonResponse({ error: 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, 500);
  }
});
