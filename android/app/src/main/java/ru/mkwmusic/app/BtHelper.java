package ru.mkwmusic.app;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothA2dp;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Bluetooth в меню «Подключить устройство»: уже знакомые телефону наушники и колонки, поиск новых рядом,
 * сопряжение и заряд подключённого устройства. Разрешение «Устройства поблизости» запрашивается только
 * когда человек сам нажал «Найти устройства»; геолокация не используется (neverForLocation).
 * Всё обёрнуто в try: на телефоне без Bluetooth или без разрешения меню просто показывает меньше.
 */
final class BtHelper {
    interface Out {
        void send(JSONObject state);
    }

    static final int REQ = 41;
    private static final String TAG = "MKWBt";

    private final Activity act;
    private final Out out;
    private final Map<String, Integer> found = new LinkedHashMap<>(); // адрес → уровень сигнала (дБм)
    private BluetoothA2dp a2dp;
    private boolean proxyAsked, receiving;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            try {
                if (BluetoothDevice.ACTION_FOUND.equals(i.getAction())) {
                    BluetoothDevice d = i.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (d != null) found.put(d.getAddress(), (int) i.getShortExtra(BluetoothDevice.EXTRA_RSSI, (short) 0));
                }
            } catch (Exception e) {
                Log.w(TAG, "found", e);
            }
            push();
        }
    };

    BtHelper(Activity a, Out o) {
        act = a;
        out = o;
    }

    boolean supported() {
        return Build.VERSION.SDK_INT >= 31; // на старых Android поиск требует геолокацию — там ведём в настройки телефона
    }

    boolean hasPerm() {
        if (Build.VERSION.SDK_INT < 31) return true;
        return act.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
                && act.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
    }

    private BluetoothAdapter adapter() {
        try {
            BluetoothManager m = (BluetoothManager) act.getSystemService(Context.BLUETOOTH_SERVICE);
            return m == null ? null : m.getAdapter();
        } catch (Exception e) {
            return null;
        }
    }

    private void ensureProxy(BluetoothAdapter ad) {
        if (proxyAsked || ad == null) return;
        proxyAsked = true;
        try {
            ad.getProfileProxy(act, new BluetoothProfile.ServiceListener() {
                @Override public void onServiceConnected(int profile, BluetoothProfile proxy) { a2dp = (BluetoothA2dp) proxy; push(); }
                @Override public void onServiceDisconnected(int profile) { a2dp = null; }
            }, BluetoothProfile.A2DP);
        } catch (Exception e) {
            Log.w(TAG, "proxy", e);
        }
    }

    private void listen(boolean on) {
        try {
            if (on && !receiving) {
                IntentFilter f = new IntentFilter();
                f.addAction(BluetoothDevice.ACTION_FOUND);
                f.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
                f.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
                f.addAction(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED);
                f.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
                if (Build.VERSION.SDK_INT >= 33) act.registerReceiver(receiver, f, Context.RECEIVER_EXPORTED);
                else act.registerReceiver(receiver, f);
                receiving = true;
            } else if (!on && receiving) {
                act.unregisterReceiver(receiver);
                receiving = false;
            }
        } catch (Exception e) {
            Log.w(TAG, "listen", e);
        }
    }

    /** Нажали «Найти устройства»: спрашиваем разрешение (если ещё нет) и ищем рядом. */
    void scan() {
        if (supported() && !hasPerm()) {
            act.requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN}, REQ);
            return;
        }
        try {
            BluetoothAdapter ad = adapter();
            if (ad != null && ad.isEnabled() && supported()) {
                ensureProxy(ad);
                listen(true);
                found.clear();
                if (ad.isDiscovering()) ad.cancelDiscovery();
                ad.startDiscovery();
            }
        } catch (Exception e) {
            Log.w(TAG, "scan", e);
        }
        push();
    }

    /** «Включить Bluetooth»: сам Android показывает своё окно с вопросом — без согласия человека приложение Bluetooth не включает. */
    void enable() {
        if (supported() && !hasPerm()) {
            act.requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN}, REQ);
            return;
        }
        try {
            BluetoothAdapter ad = adapter();
            if (ad != null && !ad.isEnabled()) act.startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), REQ);
        } catch (Exception e) {
            Log.w(TAG, "enable", e);
            try { act.startActivity(new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)); } catch (Exception ignored) { /* нет настроек */ }
        }
        push();
    }

    void stop() {
        try {
            BluetoothAdapter ad = adapter();
            if (ad != null && hasPerm() && supported() && ad.isDiscovering()) ad.cancelDiscovery();
        } catch (Exception e) {
            Log.w(TAG, "stop", e);
        }
        listen(false);
    }

    /** Нажали на устройство: новое — сопрягаем (после этого телефон сам подключает звук), знакомое — пробуем подключить. */
    boolean pair(String address) {
        try {
            BluetoothAdapter ad = adapter();
            if (ad == null || !hasPerm() || !BluetoothAdapter.checkBluetoothAddress(address)) return false;
            BluetoothDevice d = ad.getRemoteDevice(address);
            if (ad.isDiscovering()) ad.cancelDiscovery();
            if (d.getBondState() == BluetoothDevice.BOND_NONE) return d.createBond();
            if (a2dp != null) {
                // у обычных приложений нет открытого способа подключить знакомое устройство; если система не разрешит — вернём false
                Object r = BluetoothA2dp.class.getMethod("connect", BluetoothDevice.class).invoke(a2dp, d);
                return Boolean.TRUE.equals(r);
            }
        } catch (Exception e) {
            Log.w(TAG, "pair", e);
        }
        return false;
    }

    private static int battery(BluetoothDevice d) {
        try {
            Object r = BluetoothDevice.class.getMethod("getBatteryLevel").invoke(d);
            int v = r instanceof Integer ? (Integer) r : -1;
            return v >= 0 && v <= 100 ? v : -1;
        } catch (Exception e) {
            return -1;
        }
    }

    /** Заряд подключённых наушников или колонки (−1, если устройство его не сообщает или нет разрешения). */
    int connectedBattery() {
        try {
            if (!hasPerm()) return -1;
            BluetoothAdapter ad = adapter();
            if (ad == null || !ad.isEnabled()) return -1;
            ensureProxy(ad);
            if (a2dp == null) return -1;
            List<BluetoothDevice> list = a2dp.getConnectedDevices();
            return list.isEmpty() ? -1 : battery(list.get(0));
        } catch (Exception e) {
            return -1;
        }
    }

    private JSONObject item(BluetoothDevice d, boolean connected, Integer rssi) throws Exception {
        JSONObject o = new JSONObject();
        String name = d.getName();
        o.put("a", d.getAddress());
        o.put("n", name == null ? "" : name);
        o.put("bonded", d.getBondState() == BluetoothDevice.BOND_BONDED);
        o.put("bonding", d.getBondState() == BluetoothDevice.BOND_BONDING);
        o.put("connected", connected);
        BluetoothClass bc = d.getBluetoothClass();
        o.put("audio", bc != null && bc.getMajorDeviceClass() == BluetoothClass.Device.Major.AUDIO_VIDEO);
        if (connected) o.put("bat", battery(d));
        if (rssi != null && rssi != 0) o.put("rssi", rssi);
        return o;
    }

    void push() {
        JSONObject s = new JSONObject();
        try {
            s.put("supported", supported());
            s.put("perm", hasPerm());
            BluetoothAdapter ad = adapter();
            s.put("has", ad != null);
            JSONArray list = new JSONArray();
            if (ad != null && hasPerm()) {
                s.put("on", ad.isEnabled());
                if (ad.isEnabled()) {
                    ensureProxy(ad);
                    s.put("scanning", supported() && ad.isDiscovering());
                    List<BluetoothDevice> conn = a2dp == null ? null : a2dp.getConnectedDevices();
                    Set<BluetoothDevice> bonded = ad.getBondedDevices();
                    if (bonded != null) {
                        for (BluetoothDevice d : bonded) {
                            list.put(item(d, conn != null && conn.contains(d), found.get(d.getAddress())));
                        }
                    }
                    for (Map.Entry<String, Integer> e : found.entrySet()) {
                        BluetoothDevice d = ad.getRemoteDevice(e.getKey());
                        if (d.getBondState() == BluetoothDevice.BOND_BONDED) continue;
                        String n = d.getName();
                        if (n == null || n.isEmpty()) continue; // безымянные метки и датчики не показываем
                        list.put(item(d, false, e.getValue()));
                    }
                }
            }
            s.put("devices", list);
        } catch (Exception e) {
            Log.w(TAG, "state", e);
        }
        out.send(s);
    }

    void release() {
        stop();
        try {
            BluetoothAdapter ad = adapter();
            if (ad != null && a2dp != null) ad.closeProfileProxy(BluetoothProfile.A2DP, a2dp);
        } catch (Exception ignored) {
            // уже закрыт
        }
        a2dp = null;
    }
}
