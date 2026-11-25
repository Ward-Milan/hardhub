#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOCFPlugIn.h>
#include <IOKit/IOKitLib.h>
#include <IOKit/storage/nvme/NVMeSMARTLibExternal.h>
#include <stdint.h>
#include <string.h>

typedef struct {
    int32_t ok;
    uint8_t critical_warning;
    uint16_t temperature_kelvin;
    uint8_t available_spare;
    uint8_t available_spare_threshold;
    uint8_t percentage_used;
    uint64_t data_units_read_lo;
    uint64_t data_units_read_hi;
    uint64_t data_units_written_lo;
    uint64_t data_units_written_hi;
    uint64_t host_read_commands_lo;
    uint64_t host_write_commands_lo;
    uint64_t power_cycles_lo;
    uint64_t power_on_hours_lo;
    uint64_t unsafe_shutdowns_lo;
    uint64_t media_errors_lo;
} HardHubNvmeSmartResult;

static int service_is_nvme_smart_capable(io_registry_entry_t entry) {
    CFTypeRef prop = IORegistryEntryCreateCFProperty(
        entry,
        CFSTR(kIOPropertyNVMeSMARTCapableKey),
        kCFAllocatorDefault,
        0
    );
    if (!prop) {
        return 0;
    }
    int capable = 0;
    if (CFGetTypeID(prop) == CFBooleanGetTypeID()) {
        capable = CFBooleanGetValue((CFBooleanRef)prop) ? 1 : 0;
    }
    CFRelease(prop);
    return capable;
}

static io_service_t find_nvme_smart_service_for_bsd(const char *bsd_name) {
    if (!bsd_name || bsd_name[0] == '\0') {
        return IO_OBJECT_NULL;
    }

    CFMutableDictionaryRef matching = IOBSDNameMatching(kIOMainPortDefault, 0, bsd_name);
    if (!matching) {
        return IO_OBJECT_NULL;
    }

    io_service_t current = IOServiceGetMatchingService(kIOMainPortDefault, matching);
    if (current == IO_OBJECT_NULL) {
        return IO_OBJECT_NULL;
    }

    // Walk up the IORegistry Service plane from IOMedia (`disk0`) to its NVMe controller/device
    // carrying `NVMe SMART Capable = Yes`.
    for (int depth = 0; depth < 16 && current != IO_OBJECT_NULL; depth++) {
        if (service_is_nvme_smart_capable(current)) {
            return current;
        }
        io_registry_entry_t parent = IO_OBJECT_NULL;
        kern_return_t kr = IORegistryEntryGetParentEntry(current, kIOServicePlane, &parent);
        IOObjectRelease(current);
        if (kr != KERN_SUCCESS || parent == IO_OBJECT_NULL) {
            return IO_OBJECT_NULL;
        }
        current = parent;
    }

    if (current != IO_OBJECT_NULL) {
        IOObjectRelease(current);
    }
    return IO_OBJECT_NULL;
}

int hardhub_read_nvme_smart(const char *bsd_name, HardHubNvmeSmartResult *out) {
    if (!out) {
        return -1;
    }
    memset(out, 0, sizeof(*out));

    io_service_t service = find_nvme_smart_service_for_bsd(bsd_name);
    if (service == IO_OBJECT_NULL) {
        return -2;
    }

    IOCFPlugInInterface **plugin = NULL;
    SInt32 score = 0;
    kern_return_t kr = IOCreatePlugInInterfaceForService(
        service,
        kIONVMeSMARTUserClientTypeID,
        kIOCFPlugInInterfaceID,
        &plugin,
        &score
    );
    IOObjectRelease(service);

    if (kr != KERN_SUCCESS || !plugin) {
        return -3;
    }

    IONVMeSMARTInterface **smart_iface = NULL;
    HRESULT hr = (*plugin)->QueryInterface(
        plugin,
        CFUUIDGetUUIDBytes(kIONVMeSMARTInterfaceID),
        (LPVOID *)&smart_iface
    );

    if (hr != S_OK || !smart_iface) {
        IODestroyPlugInInterface(plugin);
        return -4;
    }

    NVMeSMARTData raw;
    memset(&raw, 0, sizeof(raw));
    IOReturn ret = (*smart_iface)->SMARTReadData(smart_iface, &raw);
    (*smart_iface)->Release(smart_iface);
    IODestroyPlugInInterface(plugin);

    if (ret != kIOReturnSuccess) {
        return -5;
    }

    out->ok = 1;
    out->critical_warning = raw.CRITICAL_WARNING;
    out->temperature_kelvin = raw.TEMPERATURE;
    out->available_spare = raw.AVAILABLE_SPARE;
    out->available_spare_threshold = raw.AVAILABLE_SPARE_THRESHOLD;
    out->percentage_used = raw.PERCENTAGE_USED;
    out->data_units_read_lo = raw.DATA_UNITS_READ[0];
    out->data_units_read_hi = raw.DATA_UNITS_READ[1];
    out->data_units_written_lo = raw.DATA_UNITS_WRITTEN[0];
    out->data_units_written_hi = raw.DATA_UNITS_WRITTEN[1];
    out->host_read_commands_lo = raw.HOST_READ_COMMANDS[0];
    out->host_write_commands_lo = raw.HOST_WRITE_COMMANDS[0];
    out->power_cycles_lo = raw.POWER_CYCLES[0];
    out->power_on_hours_lo = raw.POWER_ON_HOURS[0];
    out->unsafe_shutdowns_lo = raw.UNSAFE_SHUTDOWNS[0];
    out->media_errors_lo = raw.MEDIA_ERRORS[0];
    return 0;
}
