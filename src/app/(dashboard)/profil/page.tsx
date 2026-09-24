import { getProfileDetails } from "@/lib/actions/profil";
import { ProfileView } from "@/components/profil/ProfileView";

export const metadata = {
  title: "Mon profil — École Miriam",
};

export default async function ProfilPage() {
  const profile = await getProfileDetails();

  return (
    <ProfileView
      profile={
        profile
          ? {
              ...profile,
              notifications:
                profile.notifications &&
                typeof profile.notifications === "object" &&
                !Array.isArray(profile.notifications)
                  ? (profile.notifications as { email?: boolean; sms?: boolean; push?: boolean })
                  : null,
            }
          : null
      }
    />
  );
}
