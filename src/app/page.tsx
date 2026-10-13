import { WeatherApp } from '@/components/weather-app';
import { PasswordRecoveryGate } from '@/components/password-recovery';
export default function Page() {
  return (
    <PasswordRecoveryGate>
      <WeatherApp />
    </PasswordRecoveryGate>
  );
}
